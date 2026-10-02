import type { GameStateProvider } from '@pivot/engine';

/**
 * The dispatcher/API-side hot-path store (PLAN.md Section 7 Redis schemas). Extends the engine's
 * read/write `GameStateProvider` (Section 8 `redis.*` calls) with the active-user lifecycle needed by
 * the WebSocket connection lifecycle, and `/session/heartbeat`. Delivery reads `isUserActive`
 * so a stored primary counts as on-screen only while that presence entry is set. Open sockets
 * themselves stay in the API process and are not visible here. Absence never blocks a push
 * (Decision 8).
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
  /** Presence entry. `true` iff not expired. Not an open-socket count — the API deletes the
   *  entry on socket close, and the score is only a ceiling when close never arrives. */
  isUserActive(userId: string): Promise<boolean>;
  /** Lazy maintenance sweep of expired members (`zremrangebyscore active_users 0 <now-1>`). */
  sweepExpiredActiveUsers(): Promise<void>;
}
