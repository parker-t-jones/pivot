import { defaultClock, type Clock } from '@fantasy-focus/engine';
import type { FlagEvent } from '@fantasy-focus/shared';
import { resolveLikelyBroadcastSource, type BroadcastCatalog } from './broadcastLag.js';
import type {
  DispatchUser,
  FlagEventPersistence,
  GameCatalog,
  PlayerCatalog,
  UserDirectory,
} from './catalogs.js';
import { decideAction } from './decideAction.js';
import type { GameStateStore } from './providers/gameStateStore.js';
import type { RateLimitStore } from './rateLimiter.js';
import { realtimeUserChannel, type RealtimeBus } from './realtimeBus.js';

export interface DeliveryDeps {
  gameStateStore: Pick<GameStateStore, 'getGameState'>;
  gameCatalog: GameCatalog;
  playerCatalog: PlayerCatalog;
  broadcastCatalog: BroadcastCatalog;
  userDirectory: UserDirectory;
  persistence: FlagEventPersistence;
  realtimeBus: RealtimeBus;
  rateLimitStore: RateLimitStore;
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
    user_id: string;
    game_id: string;
    event_type: FlagEvent['type'];
    old_state: FlagEvent['oldState'];
    new_state: FlagEvent['newState'];
    action: {
      type: string;
      cta: string | null;
      recommended_source: string | null;
      deep_link_url: string | null;
    };
    game_summary: {
      home_team: string;
      away_team: string;
      score: { home: number; away: number };
      quarter: number;
      time_remaining_sec: number;
    };
    flagged_players: {
      player_id: string;
      first_name: string;
      last_name: string;
      position: string;
    }[];
  };
}

/**
 * PLAN.md Section 8 `deliverFlagEvent`, minus the Expo Push branch (explicitly out of scope —
 * Sprint 6). Builds the Section 9 envelope, persists to `flag_events` (Phase 3's table via the
 * structural `FlagEventPersistence`), publishes to `realtime:user:{user_id}`, and — per sprint
 * decision #8 — records the delivery into the rate-limit sliding window. The `user` powering
 * `decideAction` is passed in (already fetched by the dispatcher tick for the rate-limit check)
 * rather than re-fetched here, to avoid a redundant `getUser` round trip.
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

  const deepLinkUrl = broadcastSource
    ? ((await deps.broadcastCatalog.getGameBroadcasts(event.gameId)).find(
        (b) => b.service === broadcastSource,
      )?.deepLinkUrl ?? null)
    : null;

  const triggeringPlayerIds = [
    ...new Set(event.newState.reasons.flatMap((r) => r.triggeringPlayerIds)),
  ];
  const players =
    triggeringPlayerIds.length > 0 ? await deps.playerCatalog.getPlayers(triggeringPlayerIds) : [];

  const envelope: FlagEventEnvelope = {
    id: event.id,
    type: 'flag_event',
    timestamp: deliveredAt,
    payload: {
      user_id: event.userId,
      game_id: event.gameId,
      event_type: event.type,
      old_state: event.oldState,
      new_state: event.newState,
      action: {
        type: action.type,
        cta: action.cta,
        recommended_source: broadcastSource,
        deep_link_url: deepLinkUrl,
      },
      game_summary: {
        home_team: gameSummaryInfo?.homeTeamAbbreviation ?? gameState?.homeTeamId ?? '',
        away_team: gameSummaryInfo?.awayTeamAbbreviation ?? gameState?.awayTeamId ?? '',
        score: { home: gameState?.scoreHome ?? 0, away: gameState?.scoreAway ?? 0 },
        quarter: gameState?.quarter ?? 0,
        time_remaining_sec: gameState?.timeRemainingSec ?? 0,
      },
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
}
