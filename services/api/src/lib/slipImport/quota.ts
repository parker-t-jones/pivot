import { etCalendarDateFromInstant } from '@pivot/shared';
import type { Redis as UpstashRedis } from '@upstash/redis';
import type { Redis } from 'ioredis';

/**
 * Per-user daily counter for screenshot imports. Backed by the same Redis the API already uses;
 * in memory for local dev and tests.
 */
export interface UsageCounter {
  /** Adds one and returns the new count. The key expires after `ttlSec`. */
  increment(key: string, ttlSec: number): Promise<number>;
  /** Gives one back, e.g. when the model call failed on our side. */
  decrement(key: string): Promise<void>;
}

export class InMemoryUsageCounter implements UsageCounter {
  private readonly counts = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(key: string, ttlSec: number): Promise<number> {
    const current = this.counts.get(key);
    const live = current && current.expiresAt > this.now() ? current : undefined;
    const next = {
      count: (live?.count ?? 0) + 1,
      expiresAt: live?.expiresAt ?? this.now() + ttlSec * 1000,
    };
    this.counts.set(key, next);
    return next.count;
  }

  async decrement(key: string): Promise<void> {
    const current = this.counts.get(key);
    if (current && current.count > 0) current.count -= 1;
  }
}

export class TcpUsageCounter implements UsageCounter {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttlSec: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSec);
    return count;
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(key);
  }
}

export class UpstashUsageCounter implements UsageCounter {
  constructor(private readonly redis: UpstashRedis) {}

  async increment(key: string, ttlSec: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSec);
    return count;
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(key);
  }
}

/** Two days, so a key outlives its US Eastern day wherever the server's clock sits. */
export const SLIP_IMPORT_KEY_TTL_SEC = 2 * 24 * 60 * 60;

export function slipImportKey(userId: string, now: Date): string {
  return `slip_import:${userId}:${etCalendarDateFromInstant(now)}`;
}
