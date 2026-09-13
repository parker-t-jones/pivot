/**
 * Switching engine core types (PLAN.md Section 8 "Core types"). Field names match Section 8
 * exactly. Consumed by both the engine (`services/engine`) and the API (`services/api`), so they
 * live in `shared`.
 */

/** `game_state_history.unit_on_field` (Section 7) / Section 8. */
export type UnitOnField = 'offense' | 'defense' | 'special_teams' | 'none';

export type FlagReasonType =
  | 'offense_active'
  | 'defense_active'
  | 'red_zone'
  | 'close_game'
  | 'star_player_active';

export interface GameState {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  possessionTeamId: string | null;
  unitOnField: UnitOnField;
  scoreHome: number;
  scoreAway: number;
  quarter: number; // 1-5 (5 = OT)
  timeRemainingSec: number;
  /** Distance (yards) from the possessing team to the opponent's end zone; `null` when not applicable. */
  yardsToOpponentEndzone: number | null;
  /** Current down (1–4), or `null` when not a scrimmage situation / no possession. */
  down: number | null;
  /** Yards to go for a first down, or `null` when not a scrimmage situation / no possession. */
  distance: number | null;
  inRedZone: boolean;
  status: 'scheduled' | 'in_progress' | 'final';
  updatedAt: number; // unix ms
}

export interface FlagReason {
  type: FlagReasonType;
  triggeringPlayerIds: string[];
}

export interface FlagState {
  gameId: string;
  flagged: boolean;
  priorityScore: number;
  reasons: FlagReason[];
  computedAt: number;
}

export interface FlagEvent {
  id: string;
  userId: string;
  gameId: string;
  type: 'flag_added' | 'flag_removed' | 'priority_increased' | 'priority_decreased';
  oldState: FlagState | null;
  newState: FlagState;
  scheduledFireAt: number;
}

// `UserLineupCache` (Section 8 core types) is the Sprint 3 shape — re-exported so the engine has a
// single import surface for Section 8 types.
export type { UserLineupCache } from '../types/lineup-cache.js';
