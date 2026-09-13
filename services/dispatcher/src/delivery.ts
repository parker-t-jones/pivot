import { defaultClock, type Clock } from '@pivot/engine';
import {
  resolvePossessionAbbreviation,
  type FlagEvent,
  type FlagState,
  type GameState,
} from '@pivot/shared';
import { resolveLikelyBroadcastSource, type BroadcastCatalog } from './broadcastLag.js';
import { preferredBroadcast, resolveBroadcasts } from './broadcastResolver.js';
import type {
  DispatchUser,
  FlagEventPersistence,
  GameCatalog,
  GameSummaryInfo,
  PlayerCatalog,
  PlayerInfo,
  UserDirectory,
} from './catalogs.js';
import { decideAction } from './decideAction.js';
import {
  notificationBody,
  notificationTitle,
  type NotificationGameContext,
} from './notificationContent.js';
import type { GameStateStore } from './providers/gameStateStore.js';
import type { PushNotifier } from './pushNotifier.js';
import type { RateLimitStore } from './rateLimiter.js';
import { realtimeUserChannel, type RealtimeBus } from './realtimeBus.js';
import { buildGameSummary, type GameSummary } from './gameSummary.js';

export interface DeliveryDeps {
  gameStateStore: Pick<GameStateStore, 'getGameState'>;
  gameCatalog: GameCatalog;
  playerCatalog: PlayerCatalog;
  broadcastCatalog: BroadcastCatalog;
  userDirectory: UserDirectory;
  persistence: FlagEventPersistence;
  realtimeBus: RealtimeBus;
  rateLimitStore: RateLimitStore;
  pushNotifier: PushNotifier;
  clock?: Clock;
}

/** Section 9 "Full flag_event payload shape" — the exact envelope published to `realtime:user:{id}`
 *  so the Phase 4 WebSocket server can relay it to clients byte-for-byte with zero reshaping (the
 *  decoupling the fan-out design requires). */
export interface FlagEventEnvelope {
  id: string;
  type: 'flag_event';
  timestamp: number;
  payload: {
    /** Sprint 6 Phase 7 addition (batched Section 9 spec update) — the underlying `flag_events.id`,
     *  needed by the client to call `POST /flags/:event_id/action` from a push/banner action button.
     *  Missing from Phase 3's original shape (push `data` was set to `envelope.payload`, which never
     *  included the envelope's own top-level `id`) — additive, so no existing consumer's shape
     *  changes underneath it. */
    event_id: string;
    user_id: string;
    game_id: string;
    event_type: FlagEvent['type'];
    /** Sprint 9 Phase 1 addition — `possession_team` is an envelope-level enrichment layered on top
     *  of the frozen Section 8 `FlagState` shape (spread onto it below), not a change to `FlagState`
     *  itself, so `services/engine` stays untouched. See `resolvePossessionAbbreviation` and the
     *  `old_state` population note in `deliverFlagEvent` for why `old_state.possession_team` is
     *  unconditionally `null` rather than best-effort. */
    old_state: (FlagState & { possession_team: string | null }) | null;
    new_state: FlagState & { possession_team: string | null };
    action: {
      type: string;
      cta: string | null;
      recommended_source: string | null;
      deep_link_url: string | null;
    };
    game_summary: GameSummary;
    flagged_players: {
      player_id: string;
      first_name: string;
      last_name: string;
      position: string;
    }[];
  };
}

/**
 * Resolves `NotificationGameContext`'s `possessionTeamName`/`defenseTeamName` from the raw
 * `GameState` (which knows the team ids and which one currently has the ball) plus the enriched
 * `GameSummaryInfo` (which knows names for those ids) — kept local to `delivery.ts` rather than
 * exposed on `GameCatalog` (Sprint 6 Phase 3 instruction: this pre-resolution is notification-specific,
 * not a general catalog concern). `null` when the game has no live state yet or no possession is set
 * (matches `computeFlagState`'s own gate — a flagged event never fires without both).
 */
function resolveNotificationTeamNames(
  gameState: GameState | null,
  info: GameSummaryInfo | null,
): { possessionTeamName: string | null; defenseTeamName: string | null } {
  if (!gameState?.possessionTeamId) {
    return { possessionTeamName: null, defenseTeamName: null };
  }
  const homePossessing = gameState.possessionTeamId === gameState.homeTeamId;
  return {
    possessionTeamName: (homePossessing ? info?.homeTeamName : info?.awayTeamName) ?? null,
    defenseTeamName: (homePossessing ? info?.awayTeamName : info?.homeTeamName) ?? null,
  };
}

/**
 * Sprint 9 Phase 1 — resolves the Section 9 `new_state.possession_team` abbreviation via the shared
 * `resolvePossessionAbbreviation` helper (also used by `buildGameSummary` and `GET /games/live`).
 */
function resolvePossessionTeamAbbreviation(
  gameState: GameState | null,
  info: GameSummaryInfo | null,
): string | null {
  return resolvePossessionAbbreviation(
    gameState,
    info?.homeTeamAbbreviation,
    info?.awayTeamAbbreviation,
  );
}

/**
 * `notificationTitle` needs the players tied to the reasons it actually describes. For every event
 * type except `flag_removed` that's exactly the same `triggeringPlayerIds`/`players` already resolved
 * for the envelope's `flagged_players` (from `event.newState.reasons`) — reused as-is, no extra
 * catalog call. `flag_removed`'s `newState.reasons` is always empty (the flag cleared), so describing
 * "who's no longer active" needs `event.oldState.reasons`' triggering ids instead, which the envelope
 * never resolves — this is the one case that needs its own `getPlayers` call.
 */
async function resolveNotificationPlayers(
  deps: DeliveryDeps,
  event: FlagEvent,
  alreadyResolved: PlayerInfo[],
): Promise<PlayerInfo[]> {
  if (event.type !== 'flag_removed') return alreadyResolved;
  const oldTriggeringPlayerIds = [
    ...new Set((event.oldState?.reasons ?? []).flatMap((r) => r.triggeringPlayerIds)),
  ];
  if (oldTriggeringPlayerIds.length === 0) return [];
  return deps.playerCatalog.getPlayers(oldTriggeringPlayerIds);
}

/**
 * Sprint 7 Phase 3b — resolves the Section 9 `action.recommended_source`/`action.deep_link_url`.
 *
 * The switch CTA must stay consistent with the timing engine: `scheduleFlagEvent` (Section 8) already
 * calibrated the deferred fire time against the source `resolveLikelyBroadcastSource` picked, so the
 * recommendation points at that SAME source (its deep link is the catalog lookup for it). A second,
 * independently-computed pick that disagreed would be a real bug — the notification would be timed for
 * one broadcast while the CTA sent the user to another. (The timing heuristic itself is known-imperfect
 * in the multi-broadcast case; that gap is filed separately as a v1.5 Known Issue, out of scope here.)
 *
 * Only when there's no timing source at all (the user has zero subscribed services, so there's nothing
 * to be consistent with) do we fall back to `BroadcastResolver`'s authoritative `preferred` result —
 * e.g. a free broadcast the user has no presence row for. Both branches degrade to `null` cleanly when
 * neither yields a result (the common case until Phase 4 seeds `game_broadcasts` fixtures).
 */
async function resolveActionRecommendation(
  deps: DeliveryDeps,
  gameId: string,
  userId: string,
  timingSource: string | null,
): Promise<{ recommendedSource: string | null; deepLinkUrl: string | null }> {
  if (timingSource !== null) {
    const broadcasts = await deps.broadcastCatalog.getGameBroadcasts(gameId);
    const deepLinkUrl = broadcasts.find((b) => b.service === timingSource)?.deepLinkUrl ?? null;
    return { recommendedSource: timingSource, deepLinkUrl };
  }
  const preferred = preferredBroadcast(await resolveBroadcasts(gameId, userId, deps.broadcastCatalog));
  return {
    recommendedSource: preferred?.service ?? null,
    deepLinkUrl: preferred?.deepLinkUrl ?? null,
  };
}

/**
 * PLAN.md Section 8 `deliverFlagEvent`. Builds the Section 9 envelope, persists to `flag_events`
 * (Phase 3's table via the structural `FlagEventPersistence`), publishes to `realtime:user:{user_id}`,
 * records the delivery into the rate-limit sliding window (sprint decision #8), and — Sprint 6 Phase 3
 * — sends an Expo push carrying the identical envelope `payload` as `data`, so a client renders a push
 * exactly like a WebSocket delivery. The `user` powering `decideAction` is passed in (already fetched
 * by the dispatcher tick for the rate-limit check) rather than re-fetched here, to avoid a redundant
 * `getUser` round trip.
 *
 * Push is strictly best-effort and last in the sequence: persistence and the realtime publish already
 * succeeded by the time push is attempted, and a push failure (invalid token, Expo outage, thrown
 * error) is caught and logged, never re-thrown — Section 3's "stream lag/rate limiting" guarantees and
 * Sprint 5's persisted history must never depend on Expo being reachable.
 */
export async function deliverFlagEvent(
  deps: DeliveryDeps,
  event: FlagEvent,
  user: DispatchUser,
): Promise<void> {
  const clock = deps.clock ?? defaultClock;
  const deliveredAt = clock();

  const [session, gameState, gameSummaryInfo, broadcastSource] = await Promise.all([
    deps.userDirectory.getViewingSession(event.userId),
    deps.gameStateStore.getGameState(event.gameId),
    deps.gameCatalog.getGameSummary(event.gameId),
    resolveLikelyBroadcastSource(event.gameId, event.userId, deps.broadcastCatalog),
  ]);

  const action = decideAction(
    { subscriptionTier: user.subscriptionTier, autoSwitch: user.preferences.autoSwitch },
    {
      primaryGameId: session?.primaryGameId ?? null,
      primaryPriorityScore: session?.primaryPriorityScore ?? null,
    },
    event,
  );

  const { recommendedSource, deepLinkUrl } = await resolveActionRecommendation(
    deps,
    event.gameId,
    event.userId,
    broadcastSource,
  );

  const triggeringPlayerIds = [
    ...new Set(event.newState.reasons.flatMap((r) => r.triggeringPlayerIds)),
  ];
  const players =
    triggeringPlayerIds.length > 0 ? await deps.playerCatalog.getPlayers(triggeringPlayerIds) : [];

  const possessionTeam = resolvePossessionTeamAbbreviation(gameState, gameSummaryInfo);

  const envelope: FlagEventEnvelope = {
    id: event.id,
    type: 'flag_event',
    timestamp: deliveredAt,
    payload: {
      event_id: event.id,
      user_id: event.userId,
      game_id: event.gameId,
      event_type: event.type,
      // Ruling (Sprint 9 Phase 1 gate review): unconditionally `null`, NOT a best-effort snapshot.
      // The dispatcher only ever reads CURRENT `GameState` — there's no historical possession as of
      // when `oldState` was actually computed. Populating it from the same current snapshot used for
      // `new_state` would make old_state.possession_team == new_state.possession_team on every event,
      // which is a structured field silently lying about "possession before" vs "possession now"
      // being distinct facts. Unlike `notificationContent.ts`'s `possessionTeamName` (human-readable
      // copy, where "as of delivery time" reads fine), this is a field the client renders/compares
      // against directly, so `null` ("we don't know") is the honest value. Do not re-derive a
      // best-effort value here without revisiting this ruling.
      old_state: event.oldState ? { ...event.oldState, possession_team: null } : null,
      new_state: { ...event.newState, possession_team: possessionTeam },
      action: {
        type: action.type,
        cta: action.cta,
        recommended_source: recommendedSource,
        deep_link_url: deepLinkUrl,
      },
      game_summary: buildGameSummary(gameState, gameSummaryInfo),
      flagged_players: players.map((p) => ({
        player_id: p.playerId,
        first_name: p.firstName,
        last_name: p.lastName,
        position: p.position,
      })),
    },
  };

  await deps.persistence.persistFlagEvent({
    id: event.id,
    userId: event.userId,
    gameId: event.gameId,
    eventType: event.type,
    triggeringPlayId: null,
    priorityScore: event.newState.priorityScore,
    reasons: event.newState.reasons,
    firedAt: event.scheduledFireAt,
    deliveredAt,
  });

  await deps.realtimeBus.publish(realtimeUserChannel(event.userId), envelope);

  // Decision #8: record ONLY after a successful delivery, so a dropped/rate-limited event never
  // counts towards its own sliding window.
  await deps.rateLimitStore.recordNotification(event.userId, event.id, deliveredAt);

  // Sprint 6 Phase 3: push, strictly after persistence/publish/rate-limit bookkeeping, and strictly
  // best-effort. Skipped entirely (no catalog/notifier call at all) when there's no token to send to,
  // or when the user is already looking at this game (`in_app_indicator` — a push would be noise on
  // top of what's already on screen).
  if (user.expoPushToken && action.type !== 'in_app_indicator') {
    try {
      const notificationPlayers = await resolveNotificationPlayers(deps, event, players);
      const game: NotificationGameContext = {
        ...resolveNotificationTeamNames(gameState, gameSummaryInfo),
        quarter: gameState?.quarter ?? 0,
        timeRemainingSec: gameState?.timeRemainingSec ?? 0,
      };

      const result = await deps.pushNotifier.sendPush({
        token: user.expoPushToken,
        title: notificationTitle(event, game, notificationPlayers),
        body: notificationBody(event, game),
        data: envelope.payload,
      });

      if (!result.success) {
        console.error('[push] delivery failed', {
          userId: event.userId,
          eventId: event.id,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('[push] delivery threw', {
        userId: event.userId,
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
