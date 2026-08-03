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
  broadcast: GameBroadcast | null;
  broadcasts: GameBroadcast[];
  liveStakeGames: LiveGame[];
  weekGames: ScheduleGame[];
  lineupGroups: LineupGameGroup[];
  nextGame: ScheduleGame | null;
  nextGamePlayerCount: number;
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
 * Applies a live `flag_event` to Home without a full refetch.
 * Returns whether broadcasts need a fetch for the (possibly new) primary flag.
 */
export function applyFlagEventToHome(
  slice: HomeFlagSlice,
  payload: FlagEventPayload,
  now: Date = new Date(),
): ApplyFlagEventResult {
  if (payload.event_type === 'flag_removed') {
    if (slice.flag?.game_id !== payload.game_id) {
      return { slice, needsBroadcastFetch: false, broadcastGameId: null };
    }
    const cleared: HomeFlagSlice = {
      ...slice,
      flag: null,
      broadcast: null,
      broadcasts: [],
      branch: recomputeBranch(slice, false, now),
    };
    return { slice: cleared, needsBroadcastFetch: false, broadcastGameId: null };
  }

  // flag_added | priority_increased | priority_decreased — only surface flagged games as State 1.
  if (!payload.new_state.flagged) {
    if (slice.flag?.game_id === payload.game_id) {
      const cleared: HomeFlagSlice = {
        ...slice,
        flag: null,
        broadcast: null,
        broadcasts: [],
        branch: recomputeBranch(slice, false, now),
      };
      return { slice: cleared, needsBroadcastFetch: false, broadcastGameId: null };
    }
    return { slice, needsBroadcastFetch: false, broadcastGameId: null };
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

  // Different game — only take over State 1 if priority is strictly higher (or equal with newer event).
  if (incoming.priority_score >= current.priority_score) {
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

  return { slice, needsBroadcastFetch: false, broadcastGameId: null };
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
  const top = response.flags[0] ?? null;
  if (!top) {
    return {
      slice: {
        ...slice,
        flag: null,
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
      broadcast: sameGame ? slice.broadcast : null,
      broadcasts: sameGame ? slice.broadcasts : [],
      branch: recomputeBranch(slice, true, now),
    },
    needsBroadcastFetch: !sameGame || slice.broadcasts.length === 0,
    broadcastGameId: top.game_id,
  };
}
