import { randomUUID } from 'node:crypto';

/**
 * The minimal surface `RealtimeConnection` needs from the underlying socket. The real `/v1/realtime`
 * route passes the `ws` `WebSocket` instance `@fastify/websocket` hands it (which satisfies this
 * shape); tests pass a fake, so connection/routing logic is verifiable without a live socket.
 */
export interface SendableSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * Per-connection state (Phase 4): `subscribedGameIds`, the last-ping timestamp, and `userId` from the
 * JWT. Lives only in process memory — never in Redis, which is reserved for cross-process fan-out
 * (sprint instruction: "Redis is for cross-process fanout, not per-connection tracking").
 */
export class RealtimeConnection {
  readonly id: string = randomUUID();
  readonly subscribedGameIds = new Set<string>();
  /** Timestamp of the last client `ping` message (Section 9's "last pong received" is this from the
   *  server's perspective — a `pong` is sent as an immediate reply, so "time since last ping" and
   *  "time since last pong sent" are the same clock). Drives the 40s idle-close sweep. */
  private lastPingAt: number;

  constructor(
    private readonly socket: SendableSocket,
    readonly userId: string,
    now: number,
  ) {
    this.lastPingAt = now;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  touchPing(now: number): void {
    this.lastPingAt = now;
  }

  isStale(now: number, timeoutMs: number): boolean {
    return now - this.lastPingAt > timeoutMs;
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
