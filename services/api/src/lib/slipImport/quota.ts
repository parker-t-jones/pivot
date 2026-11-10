import { etCalendarDateFromInstant } from '@pivot/shared';
import type { Redis as UpstashRedis } from '@upstash/redis';
import type { Redis } from 'ioredis';
import type { NflState } from '../../cache/index.js';

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

/** Two days, so a key outlives its US Eastern day wherever the server's clock sits. Pro only:
 *  Pro's counter is still daily, keyed by ET date. */
export const SLIP_IMPORT_PRO_KEY_TTL_SEC = 2 * 24 * 60 * 60;

/** Nine days: longer than any NFL week, even a short one, so a free-tier key always expires
 *  instead of growing unbounded, but never outlives the week it was issued for. */
export const SLIP_IMPORT_FREE_KEY_TTL_SEC = 9 * 24 * 60 * 60;

/** Pro: daily counter, keyed by the US Eastern calendar date. */
export function slipImportProKey(userId: string, now: Date): string {
  return `slip_import:${userId}:${etCalendarDateFromInstant(now)}`;
}

/**
 * Free: weekly counter, keyed by the current NFL season/week (#40) — the week this read attempt
 * happened in, which can differ from the week a slip's legs end up matching after parsing (e.g.
 * near a week boundary). That's expected: the limit is on read attempts, not on the picks' week.
 */
export function slipImportFreeKey(userId: string, nflState: Pick<NflState, 'season' | 'week'>): string {
  return `slip_import:${userId}:${nflState.season}:${nflState.week}`;
}
