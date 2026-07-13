/**
 * Section 7's `active_users` liveness window ("user_ids with viewing session in last 5 min").
 * Shared by every writer of that ZSET so they can't drift apart: the WebSocket route's
 * connect/ping refresh (`routes/realtime.ts`) and the REST `POST /session/heartbeat` equivalent
 * (`routes/session.ts`) — "Key design notes": "`/session/heartbeat` updates Redis `active_users`.
 * WebSocket `ping` keeps socket alive. Separate concerns," but both must expire on the same clock.
 */
export const ACTIVE_USER_TTL_MS = 5 * 60_000;
