import { Redis as IORedis } from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';
import {
  InMemoryRealtimeBus,
  RedisRealtimeBus,
  type RealtimeBus,
  type RealtimeMessageHandler,
  type RealtimeSubscriber,
  type RealtimeSubscription,
} from './realtimeBus.js';

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * `ioredis`-backed `RealtimeSubscriber` (sprint decision #1). A single TCP connection serves every
 * `subscribe`/`psubscribe` call the process makes — Redis multiplexes channels/patterns over one
 * connection, so this fans incoming `message`/`pmessage` events out to the handlers registered for
 * that specific channel/pattern rather than opening a connection per call.
 */
export class RedisRealtimeSubscriber implements RealtimeSubscriber {
  private readonly redis: IORedis;
  private readonly exactHandlers = new Map<string, Set<RealtimeMessageHandler>>();
  private readonly patternHandlers = new Map<string, Set<RealtimeMessageHandler>>();

  constructor(tcpUrl: string) {
    this.redis = new IORedis(tcpUrl);
    this.redis.on('message', (channel: string, raw: string) => {
      for (const handler of this.exactHandlers.get(channel) ?? []) {
        handler(channel, safeParse(raw));
      }
    });
    this.redis.on('pmessage', (pattern: string, channel: string, raw: string) => {
      for (const handler of this.patternHandlers.get(pattern) ?? []) {
        handler(channel, safeParse(raw));
      }
    });
  }

  async subscribe(channel: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription> {
    const handlers = this.exactHandlers.get(channel) ?? new Set();
    handlers.add(handler);
    this.exactHandlers.set(channel, handlers);
    await this.redis.subscribe(channel);
    return {
      unsubscribe: async () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.exactHandlers.delete(channel);
          await this.redis.unsubscribe(channel);
        }
      },
    };
  }

  async psubscribe(pattern: string, handler: RealtimeMessageHandler): Promise<RealtimeSubscription> {
    const handlers = this.patternHandlers.get(pattern) ?? new Set();
    handlers.add(handler);
    this.patternHandlers.set(pattern, handlers);
    await this.redis.psubscribe(pattern);
    return {
      unsubscribe: async () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.patternHandlers.delete(pattern);
          await this.redis.punsubscribe(pattern);
        }
      },
    };
  }

  /** Closes the dedicated TCP connection — call on process/server shutdown. */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** Config for `createRealtimeChannels`. Kept structural (not imported from `@fantasy-focus/api`'s
 *  `env.ts`) for the same reason as `RedisProviderConfig` (sprint decision #9) — dependencies run
 *  api -> dispatcher, never the reverse. */
export interface RealtimeChannelsConfig {
  cacheDriver: 'memory' | 'redis';
  upstashRestUrl?: string | undefined;
  upstashRestToken?: string | undefined;
  /** The `rediss://` TCP connection string (Upstash dashboard) — required only for `psubscribe`, since
   *  the REST client can't hold a persistent subscription (decision #1). */
  upstashTcpUrl?: string | undefined;
}

export interface RealtimeChannels {
  bus: RealtimeBus;
  subscriber: RealtimeSubscriber;
  /** Closes any owned network connections (no-op for the in-memory pair). */
  close(): Promise<void>;
}

/** Mirrors `createGameStateStore` (Phase 1): `cacheDriver` selects the implementation at boot. The
 *  in-memory pair is a single `InMemoryRealtimeBus` instance serving both roles (see its docstring);
 *  the Redis pair is two distinct clients (REST for publish, TCP for subscribe). */
export function createRealtimeChannels(config: RealtimeChannelsConfig): RealtimeChannels {
  if (config.cacheDriver === 'redis') {
    if (!config.upstashRestUrl || !config.upstashRestToken || !config.upstashTcpUrl) {
      throw new Error(
        'CACHE_DRIVER=redis requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and UPSTASH_REDIS_TCP_URL.',
      );
    }
    const bus = new RedisRealtimeBus(
      new UpstashRedis({ url: config.upstashRestUrl, token: config.upstashRestToken }),
    );
    const subscriber = new RedisRealtimeSubscriber(config.upstashTcpUrl);
    return { bus, subscriber, close: () => subscriber.close() };
  }
  const inMemory = new InMemoryRealtimeBus();
  return {
    bus: inMemory,
    subscriber: inMemory,
    close: async () => {
      // No network connection to close for the in-memory pair.
    },
  };
}
