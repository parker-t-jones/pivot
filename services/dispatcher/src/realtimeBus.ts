import type { Redis } from '@upstash/redis';

/** `realtime:user:{user_id}` / `realtime:game:{game_id}` (Section 6/Phase 4 fan-out design). */
export function realtimeUserChannel(userId: string): string {
  return `realtime:user:${userId}`;
}

/** Unused until Phase 4 (`game_state_update` fan-out) — kept alongside its sibling for naming
 *  consistency, not because anything publishes to it yet. */
export function realtimeGameChannel(gameId: string): string {
  return `realtime:game:${gameId}`;
}

/**
 * Decouples the dispatcher from the WebSocket process (Phase 4 requirement — "multiple API instances
 * can receive fanout"). Only the publish side is needed here; Phase 4 adds the subscribe side
 * (necessarily `ioredis`-backed per sprint decision #1, since `@upstash/redis`'s REST client can't
 * hold a persistent SUBSCRIBE connection — publish, being a simple write command, works fine over
 * REST and needs no such connection).
 */
export interface RealtimeBus {
  publish(channel: string, message: unknown): Promise<void>;
}

/** In-memory `RealtimeBus` for local dev and the standard test suite — records every publish. */
export class InMemoryRealtimeBus implements RealtimeBus {
  readonly published: { channel: string; message: unknown }[] = [];

  async publish(channel: string, message: unknown): Promise<void> {
    this.published.push({ channel, message });
  }
}

/** Upstash REST-backed `RealtimeBus`. `PUBLISH` is a plain write command and works over REST. */
export class RedisRealtimeBus implements RealtimeBus {
  constructor(private readonly redis: Redis) {}

  async publish(channel: string, message: unknown): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }
}
