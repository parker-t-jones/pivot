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

export type RealtimeMessageHandler = (channel: string, message: unknown) => void;

export interface RealtimeSubscription {
  unsubscribe(): Promise<void>;
}

/**
 * Phase 4 subscribe side (sprint decision #1). Mirrors Redis's `SUBSCRIBE`/`PSUBSCRIBE` split: exact
 * channel names (`realtime:user:{id}`) vs. glob patterns (`realtime:user:*`) are genuinely different
 * server-side operations, so this interface keeps them as separate methods rather than one method
 * with an `isPattern` flag. The concrete Redis implementation is `ioredis`-backed
 * (`realtimeSubscriber.ts`) — the Upstash REST client used for `RealtimeBus` cannot hold a persistent
 * subscription.
 */
export interface RealtimeSubscriber {
  subscribe(channel: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription>;
  psubscribe(pattern: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription>;
}

/** Redis glob matching restricted to the single `*` wildcard — the only pattern shape this project
 *  ever issues (`realtime:user:*` / `realtime:game:*`). Not a general glob implementation. */
function matchesPattern(pattern: string, channel: string): boolean {
  const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`).test(channel);
}

/**
 * In-memory `RealtimeBus`/`RealtimeSubscriber` for local dev and the standard test suite. Unlike the
 * real Redis pair (separate REST/TCP clients, genuinely decoupled processes), this single class
 * implements both roles and `publish` invokes matching local handlers directly — this is what makes
 * `CACHE_DRIVER=memory` exercise the full WebSocket fan-out path in tests without any Redis at all.
 */
export class InMemoryRealtimeBus implements RealtimeBus, RealtimeSubscriber {
  readonly published: { channel: string; message: unknown }[] = [];
  private readonly exactHandlers = new Map<string, Set<RealtimeMessageHandler>>();
  private readonly patternHandlers = new Map<string, Set<RealtimeMessageHandler>>();

  async publish(channel: string, message: unknown): Promise<void> {
    this.published.push({ channel, message });
    for (const handler of this.exactHandlers.get(channel) ?? []) {
      handler(channel, message);
    }
    for (const [pattern, handlers] of this.patternHandlers) {
      if (matchesPattern(pattern, channel)) {
        for (const handler of handlers) handler(channel, message);
      }
    }
  }

  async subscribe(channel: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription> {
    const handlers = this.exactHandlers.get(channel) ?? new Set();
    handlers.add(handler);
    this.exactHandlers.set(channel, handlers);
    return {
      unsubscribe: async () => {
        handlers.delete(handler);
      },
    };
  }

  async psubscribe(pattern: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription> {
    const handlers = this.patternHandlers.get(pattern) ?? new Set();
    handlers.add(handler);
    this.patternHandlers.set(pattern, handlers);
    return {
      unsubscribe: async () => {
        handlers.delete(handler);
      },
    };
  }
}

/** Upstash REST-backed `RealtimeBus`. `PUBLISH` is a plain write command and works over REST. */
export class RedisRealtimeBus implements RealtimeBus {
  constructor(private readonly redis: Redis) {}

  async publish(channel: string, message: unknown): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }
}
