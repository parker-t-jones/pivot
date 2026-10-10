import type { GameStateProvider } from '@pivot/engine';
import type { PresenceConnection } from '../presence.js';

/**
 * The dispatcher/API-side hot-path store (PLAN.md Section 7 Redis schemas). Extends the engine's
 * read/write `GameStateProvider` (Section 8 `redis.*` calls) with the active-user lifecycle needed by
 * the WebSocket connection lifecycle, and `/session/heartbeat`. Delivery reads `isUserActive`
 * for the one-per-user action and `isDeviceActive` for the push. Open sockets stay in the API
 * process. Absence never blocks a push (Decision 8).
 *
 * `active_users` is a sorted set scored by expiry-ms (sprint decision #4). A bare user id is the
 * legacy iOS client. A `c|...` member is one connection. Membership is `score >= now`. A hidden
 * web connection does not count. `getActiveUsers()` returns unique user ids that currently count.
 *
 * `getUserFlagState`/`setUserFlagState` back the cross-process `user_flag_state:{user_id}:{game_id}`
 * hash (sprint decision #3 — a Section 7 addition, since Section 8's pseudocode reads as in-process
 * memory but the engine writes and the dispatcher reads across process boundaries).
 */
export interface GameStateStore extends GameStateProvider {
  /** Legacy slot: bare user id, device `legacy-ios`, until `now + ttlMs`. Heartbeat and a
   *  TestFlight socket. Refreshes that one member. */
  markUserActive(userId: string, ttlMs: number): Promise<void>;
  /** Drop the legacy user-id member. Does not remove connection members. */
  removeActiveUser(userId: string): Promise<void>;
  /** One connection until `now + ttlMs`. Replaces any member with the same connection id. */
  markConnectionActive(connection: PresenceConnection, ttlMs: number): Promise<void>;
  /** Drop every member for this connection id. Other connections stay. */
  removeConnection(connectionId: string): Promise<void>;
  /** Legacy member, or any counting connection for this user. Hidden web does not count. */
  isUserActive(userId: string): Promise<boolean>;
  /** Legacy member when `deviceId` is `legacy-ios`, or a counting connection for this device. */
  isDeviceActive(userId: string, deviceId: string): Promise<boolean>;
  /** Lazy maintenance sweep of expired members (`zremrangebyscore active_users 0 <now-1>`). */
  sweepExpiredActiveUsers(): Promise<void>;
}
