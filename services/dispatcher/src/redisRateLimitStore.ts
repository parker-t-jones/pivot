import type { Redis } from '@upstash/redis';
import { NOTIFICATIONS_KEY_TTL_SECONDS, type RateLimitStore } from './rateLimiter.js';

function notificationsKey(userId: string): string {
  return `user_notifications:${userId}`;
}

/** Upstash-backed `RateLimitStore` — `user_notifications:{user_id}` sorted set (PLAN.md Section 7). */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async countRecentNotifications(
    userId: string,
    sinceMs: number,
    untilMs: number,
  ): Promise<number> {
    return await this.redis.zcount(notificationsKey(userId), sinceMs, untilMs);
  }

  async recordNotification(userId: string, eventId: string, deliveredAtMs: number): Promise<void> {
    const key = notificationsKey(userId);
    await this.redis.zadd(key, { score: deliveredAtMs, member: eventId });
    // Key-hygiene expiry (decision #8) — cosmetic, doesn't affect sliding-window correctness since
    // `countRecentNotifications` is always range-bounded by the caller.
    await this.redis.expire(key, NOTIFICATIONS_KEY_TTL_SECONDS);
  }
}
