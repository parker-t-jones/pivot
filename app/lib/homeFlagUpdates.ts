/**
 * Pure Home flag-state transitions for Sprint 10 Phase 3 WebSocket deltas + reconnect reconcile.
 * Keeps mapping/ranking logic unit-testable without React or a live socket.
 */
import type { FlagEventPayload } from './flagEventPayload';
import type { CurrentFlag, FlagsCurrentResponse, GameBroadcast } from './gameDisplay';
import {
  nextStakeKickoff,
  resolveHomeBranch,
  stakeTeamAbbreviations,
  type HomeBranch,
  type LineupGameGroup,
} from './homeState';
import type { LineupResponse } from './leagues';
import type { NflStateResponse } from './nflState';
import type { LiveGame, ScheduleGame } from './schedule';
import type { PlayerTeamMap } from './teamDisplay';

/** Minimal Home snapshot the WS layer mutates (matches `HomeData` fields used for State 1–4). */
export interface HomeFlagSlice {
  hasLeagues: boolean;
  nflState: NflStateResponse | null;
  playerTeamMap: PlayerTeamMap;
  lineups: LineupResponse[];
  flag: CurrentFlag | null;
  /** PLAN.md Section 10 State 1 "Also flagged" row — every flagged game below the primary, kept
   *  priority-sorted (matches `/flags/current`'s own sort). Never fetched a broadcast eagerly for
   *  these — `AlsoFlaggedRow`'s Switch button resolves that on tap. */
  otherFlags: CurrentFlag[];
  broadcast: GameBroadcast | null;
  broadcasts: GameBroadcast[];
  liveStakeGames: LiveGame[];
  weekGames: ScheduleGame[];
  lineupGroups: LineupGameGroup[];
  upcomingGames: LineupGameGroup[];
  countdownMs: number;
  branch: HomeBranch;
}

/** Section 9 `/flags/current` `recommended_action` mapping — CTA-driven, same as API `toRecommendedAction`. */
export function recommendedActionFromFlagEvent(
  action: FlagEventPayload['action'],
): CurrentFlag['recommended_action'] {
  if (action.cta === 'switch_primary') return 'switch_primary';
  if (action.cta === 'add_to_split') return 'add_to_split';
  return 'notify_only';
}

export function flagEventToCurrentFlag(payload: FlagEventPayload): CurrentFlag {
  return {
    game_id: payload.game_id,
    priority_score: payload.new_state.priorityScore,
    reasons: payload.new_state.reasons.map((r) => r.type),
    flagged_players: payload.flagged_players,
    game: payload.game_summary,
    recommended_action: recommendedActionFromFlagEvent(payload.action),
  };
}

/** Same tie-break as `/flags/current` (`flags.ts`): priority descending, game_id ascending. */
function sortFlags(flags: CurrentFlag[]): CurrentFlag[] {
  return [...flags].sort(
    (a, b) => b.priority_score - a.priority_score || a.game_id.localeCompare(b.game_id),
  );
}

function removeOtherFlag(otherFlags: CurrentFlag[], gameId: string): CurrentFlag[] {
  return otherFlags.filter((entry) => entry.game_id !== gameId);
}

/** Inserts/updates by `game_id`, re-sorting so a priority change re-ranks it in place. */
function upsertOtherFlag(otherFlags: CurrentFlag[], flag: CurrentFlag): CurrentFlag[] {
  return sortFlags([...removeOtherFlag(otherFlags, flag.game_id), flag]);
}

function recomputeBranch(slice: HomeFlagSlice, hasFlags: boolean, now: Date): HomeBranch {
  if (!slice.nflState) return slice.branch;
  const stakeTeams = stakeTeamAbbreviations(slice.playerTeamMap);
  return resolveHomeBranch({
    hasLeagues: slice.hasLeagues,
    displayPhase: slice.nflState.display_phase,
    hasFlags,
    hasLiveStakeGames: slice.liveStakeGames.length > 0,
    nextStakeKickoff: nextStakeKickoff(slice.weekGames, stakeTeams, now),
    now,
  });
}

export interface ApplyFlagEventResult {
  slice: HomeFlagSlice;
  /** True when State 1's game_id changed (or became set) and broadcasts should be fetched. */
  needsBroadcastFetch: boolean;
  /** game_id to fetch broadcasts for when `needsBroadcastFetch` is true. */
  broadcastGameId: string | null;
}

/**
 * Removes a game from either the primary flag slot or the "also flagged" list — shared by
 * `flag_removed` and the `flagged: false` (priority dropped below threshold) case below. Promotes
 * the top of `otherFlags` into the primary slot when the primary is the one being cleared, rather
 * than just dropping to no flag at all while other flagged games are still live.
 */
function clearFlag(slice: HomeFlagSlice, gameId: string, now: Date): ApplyFlagEventResult {
  if (slice.flag?.game_id !== gameId) {
    const otherFlags = removeOtherFlag(slice.otherFlags, gameId);
    if (otherFlags.length === slice.otherFlags.length) {
      return { slice, needsBroadcastFetch: false, broadcastGameId: null };
    }
    return { slice: { ...slice, otherFlags }, needsBroadcastFetch: false, broadcastGameId: null };
  }

  const [promoted, ...rest] = slice.otherFlags;
  if (!promoted) {
    const cleared: HomeFlagSlice = {
      ...slice,
      flag: null,
      broadcast: null,
      broadcasts: [],
      branch: recomputeBranch(slice, false, now),
    };
    return { slice: cleared, needsBroadcastFetch: false, broadcastGameId: null };
  }

  const promotedSlice: HomeFlagSlice = {
    ...slice,
    flag: promoted,
    otherFlags: rest,
    broadcast: null,
    broadcasts: [],
    branch: recomputeBranch(slice, true, now),
  };
  return { slice: promotedSlice, needsBroadcastFetch: true, broadcastGameId: promoted.game_id };
}

/**
 * Applies a live `flag_event` to Home without a full refetch.
 * Returns whether broadcasts need a fetch for the (possibly new) primary flag.
 */
export function applyFlagEventToHome(
  slice: HomeFlagSlice,
  payload: FlagEventPayload,
  now: Date = new Date(),
): ApplyFlagEventResult {
  if (payload.event_type === 'flag_removed') {
    return clearFlag(slice, payload.game_id, now);
  }

  // flag_added | priority_increased | priority_decreased — only surface flagged games as State 1
  // (primary) or the "also flagged" row (everything else).
  if (!payload.new_state.flagged) {
    return clearFlag(slice, payload.game_id, now);
  }

  const incoming = flagEventToCurrentFlag(payload);
  const current = slice.flag;

  if (!current) {
    return {
      slice: {
        ...slice,
        flag: incoming,
        broadcast: null,
        broadcasts: [],
        branch: recomputeBranch(slice, true, now),
      },
      needsBroadcastFetch: true,
      broadcastGameId: incoming.game_id,
    };
  }

  if (current.game_id === incoming.game_id) {
    return {
      slice: {
        ...slice,
        flag: incoming,
        branch: recomputeBranch(slice, true, now),
      },
      needsBroadcastFetch: false,
      broadcastGameId: null,
    };
  }

  // Different game — only take over State 1 if priority is strictly higher (or equal with newer
  // event); the old primary demotes into the "also flagged" list rather than being dropped.
  if (incoming.priority_score >= current.priority_score) {
    return {
      slice: {
        ...slice,
        flag: incoming,
        otherFlags: upsertOtherFlag(removeOtherFlag(slice.otherFlags, incoming.game_id), current),
        broadcast: null,
        broadcasts: [],
        branch: recomputeBranch(slice, true, now),
      },
      needsBroadcastFetch: true,
      broadcastGameId: incoming.game_id,
    };
  }

  // Doesn't overtake the primary — track/update it in the also-flagged list instead of dropping it.
  return {
    slice: { ...slice, otherFlags: upsertOtherFlag(slice.otherFlags, incoming) },
    needsBroadcastFetch: false,
    broadcastGameId: null,
  };
}

/**
 * Reconciles Home against a fresh `GET /flags/current` after a reconnect / foreground resume.
 * Flags pushed while the socket was down have no replay — this closes the gap.
 */
export function reconcileHomeWithFlagsCurrent(
  slice: HomeFlagSlice,
  response: FlagsCurrentResponse,
  now: Date = new Date(),
): ApplyFlagEventResult {
  // Already priority-sorted server-side (`flags.ts`) — everything after the top is the
  // "also flagged" row as-is, no re-sort needed.
  const [top, ...otherFlags] = response.flags;
  if (!top) {
    return {
      slice: {
        ...slice,
        flag: null,
        otherFlags: [],
        broadcast: null,
        broadcasts: [],
        branch: recomputeBranch(slice, false, now),
      },
      needsBroadcastFetch: false,
      broadcastGameId: null,
    };
  }

  const sameGame = slice.flag?.game_id === top.game_id;
  return {
    slice: {
      ...slice,
      flag: top,
      otherFlags,
      broadcast: sameGame ? slice.broadcast : null,
      broadcasts: sameGame ? slice.broadcasts : [],
      branch: recomputeBranch(slice, true, now),
    },
    needsBroadcastFetch: !sameGame || slice.broadcasts.length === 0,
    broadcastGameId: top.game_id,
  };
}
