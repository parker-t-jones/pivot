import type { UserLineupCache } from '@pivot/shared';

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

  /**
   * `users_with_bet:{game_id}` — users with a manual bet on that game.
   * `user_bet_games:{user_id}:{week}` remembers which games were indexed so a rebuild can drop stale ones.
   */
  addUserBet(gameId: string, userId: string, week: number): Promise<void>;
  removeUserBet(gameId: string, userId: string, week: number): Promise<void>;
  getUsersWithBet(gameId: string): Promise<string[]>;
  getUserBetGames(userId: string, week: number): Promise<string[]>;

  /** `current_nfl_state`, short-TTL cache of Sleeper's `/v1/state/nfl` (Sprint 3). */
  getNflState(): Promise<NflState | null>;
  setNflState(state: NflState, ttlSec: number): Promise<void>;
}

/**
 * TTL for `user_lineup_cache:{user_id}:{week}`, refreshed by every rebuild. A week's key is only
 * read while that week is current (about 7 days), so 14 days always outlives its useful life while
 * old weeks still disappear. Do not shorten below a week: a missing key means no routing for that
 * user until the next rebuild.
 *
 * Also used for `users_with_bet:{game_id}` and `user_bet_games:{user_id}:{week}`, refreshed on
 * every add (including historical-week resyncs). Game routing only needs the index while the
 * game is live; 14 days outlives its week and bounds retention after the last resync.
 */
export const LINEUP_CACHE_KEY_TTL_SECONDS = 14 * 24 * 60 * 60;
