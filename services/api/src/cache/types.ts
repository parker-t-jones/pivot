import type { UserLineupCache } from '@fantasy-focus/shared';

/** Current NFL week/season, sourced from Sleeper's `/v1/state/nfl` (Sprint 3 substitute for Sportradar). */
export interface NflState {
  season: string;
  week: number;
  seasonType: 'pre' | 'regular' | 'post' | 'off';
  /**
   * ISO date `YYYY-MM-DD` from Sleeper when present. Phase-relative (preseason opener during
   * `'pre'`, often null during `'off'`) — NOT the regular-season opener. Passed through on
   * `GET /state/nfl`; State 4a must not assert a season-start claim from it (see PLAN Known Issues).
   */
  seasonStartDate: string | null;
}

/**
 * Hides the Redis hot-path (Section 7 "Redis schemas") behind an interface so Sprint 3 can ship
 * without Upstash provisioned (per PLAN.md Section 2 swap-ready architecture principle).
 */
export interface LineupCacheProvider {
  setLineupCache(userId: string, week: number, cache: UserLineupCache): Promise<void>;
  getLineupCache(userId: string, week: number): Promise<UserLineupCache | null>;

  /** `users_with_stake:{team_id}` (Section 7). */
  addUserStake(teamId: string, userId: string): Promise<void>;
  removeUserStake(teamId: string, userId: string): Promise<void>;
  getUsersWithStake(teamId: string): Promise<string[]>;

  /** `current_nfl_state`, short-TTL cache of Sleeper's `/v1/state/nfl` (Sprint 3). */
  getNflState(): Promise<NflState | null>;
  setNflState(state: NflState, ttlSec: number): Promise<void>;
}
