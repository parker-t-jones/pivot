import type { GameStateProvider } from '@roster-remote/engine';

/**
 * The dispatcher/API-side hot-path store (PLAN.md Section 7 Redis schemas). Extends the engine's
 * read/write `GameStateProvider` (Section 8 `redis.*` calls) with the active-user lifecycle needed by
 * the dispatcher's `isStillRelevant` liveness gate, the WebSocket connection lifecycle, and
 * `/session/heartbeat`.
 *
 * `active_users` is modeled as a sorted set scored by expiry-ms (sprint decision #4): a plain Redis
 * set can't express Section 7's "user_ids with viewing session in last 5 min" TTL. Membership is
 * `score >= now`; expired members are lazily swept. `getActiveUsers()` (inherited) therefore returns
 * only non-expired users.
 *
 * `getUserFlagState`/`setUserFlagState` back the cross-process `user_flag_state:{user_id}:{game_id}`
 * hash (sprint decision #3 — a Section 7 addition, since Section 8's pseudocode reads as in-process
 * memory but the engine writes and the dispatcher reads across process boundaries).
 */
export interface GameStateStore extends GameStateProvider {
  /** Mark a user active until `now + ttlMs` (heartbeat, WebSocket connect). Refreshes any existing entry. */
  markUserActive(userId: string, ttlMs: number): Promise<void>;
  /** Drop a user immediately (WebSocket disconnect). */
  removeActiveUser(userId: string): Promise<void>;
  /** Liveness check used by the dispatcher's `isStillRelevant` gate. `true` iff not expired. */
  isUserActive(userId: string): Promise<boolean>;
  /** Lazy maintenance sweep of expired members (`zremrangebyscore active_users 0 <now-1>`). */
  sweepExpiredActiveUsers(): Promise<void>;
}
