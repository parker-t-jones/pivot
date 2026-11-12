import type { Redis as IoRedis } from 'ioredis';
import type { Redis as UpstashRedis } from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimitStore, RedisRateLimitStore } from '@pivot/dispatcher';
import { tcpRateLimit } from './tcpRedis.js';

/** Model sorted-set scores and lazy expiry without connecting to Redis. */
function fakeClient() {
  const entries = new Map<string, { scores: Map<string, number>; expiresAt?: number }>();
  function read(key: string) {
    const entry = entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }
  const client = {
    zadd: vi.fn(
      async (key: string, value: number | { score: number; member: string }, member?: string) => {
        const entry = read(key) ?? { scores: new Map<string, number>() };
        if (typeof value === 'number') {
          if (member === undefined) throw new Error('TCP ZADD requires a member');
          entry.scores.set(member, value);
        } else entry.scores.set(value.member, value.score);
        entries.set(key, entry);
        return 1;
      },
    ),
    zremrangebyscore: vi.fn(async (key: string, min: string, max: string) => {
      expect(min).toBe('-inf');
      expect(max.startsWith('(')).toBe(true);
      const entry = read(key);
      const cutoff = Number(max.slice(1));
      for (const [member, score] of entry?.scores ?? []) {
        if (score < cutoff) entry?.scores.delete(member);
      }
      if (entry?.scores.size === 0) entries.delete(key);
      return 0;
    }),
    zcount: vi.fn(
      async (key: string, since: number, until: number) =>
        [...(read(key)?.scores.values() ?? [])].filter((score) => score >= since && score <= until)
          .length,
    ),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = read(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
      return entry ? 1 : 0;
    }),
  };
  return { client, entries };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

const providers = [
  ['TCP', () => tcpRateLimit(fakeClient().client as unknown as IoRedis)],
  ['Upstash', () => new RedisRateLimitStore(fakeClient().client as unknown as UpstashRedis)],
  ['in-memory', () => new InMemoryRateLimitStore()],
] as const;

describe.each(providers)('%s notification retention', (_name, make) => {
  it('prunes old scores on write and keeps the cutoff, margin, read boundaries and future scores', async () => {
    const store = make();
    await store.recordNotification('user', 'future', 70_002);
    await store.recordNotification('user', 'old', 0);
    await store.recordNotification('user', 'cutoff', 1);
    await store.recordNotification('user', 'margin', 5_001);
    await store.recordNotification('user', 'window-start', 10_001);
    await store.recordNotification('other', 'isolated', 0);
    vi.setSystemTime(70_001);
    // A slightly out-of-order delivery must not prune a future score.
    await store.recordNotification('user', 'current', Date.now());
    expect(await store.countRecentNotifications('user', -Infinity, Infinity)).toBe(5);
    expect(await store.countRecentNotifications('user', 1, 1)).toBe(1);
    expect(await store.countRecentNotifications('user', 5_001, 5_001)).toBe(1);
    expect(await store.countRecentNotifications('user', Date.now() - 60_000, Date.now())).toBe(2);
    expect(await store.countRecentNotifications('other', -Infinity, Infinity)).toBe(1);
    vi.setSystemTime(80_002);
    await store.recordNotification('user', 'next', Date.now());
    expect(await store.countRecentNotifications('user', -Infinity, Infinity)).toBe(3);
  });

  it('does not prune on reads and bounds sustained-write history', async () => {
    const store = make();
    await store.recordNotification('user', 'old', Date.now());
    vi.setSystemTime(100_000);
    expect(await store.countRecentNotifications('user', 40_000, Date.now())).toBe(0);
    expect(await store.countRecentNotifications('user', 0, 0)).toBe(1);
    for (let i = 1; i <= 100; i++) {
      vi.setSystemTime(i * 100_000);
      await store.recordNotification('user', `event-${i}`, Date.now());
    }
    expect(await store.countRecentNotifications('user', -Infinity, Infinity)).toBe(1);
  });
});

describe.each(['TCP', 'Upstash'])('%s notification commands', (provider) => {
  it('prunes with an exclusive cutoff and refreshes the existing one-hour expiry on every write', async () => {
    const { client, entries } = fakeClient();
    const store =
      provider === 'TCP'
        ? tcpRateLimit(client as unknown as IoRedis)
        : new RedisRateLimitStore(client as unknown as UpstashRedis);
    await store.recordNotification('user', 'event', Date.now());
    vi.setSystemTime(1_000);
    await store.recordNotification('user', 'event', Date.now());
    expect(client.zremrangebyscore).toHaveBeenCalledTimes(2);
    expect(client.zremrangebyscore).toHaveBeenLastCalledWith(
      'user_notifications:user',
      '-inf',
      '(-69000',
    );
    expect(client.expire).toHaveBeenCalledTimes(2);
    expect(client.expire).toHaveBeenLastCalledWith('user_notifications:user', 3600);
    expect(entries.get('user_notifications:user')?.expiresAt).toBe(3_601_000);
    await store.countRecentNotifications('user', 0, 1_000);
    expect(client.zcount).toHaveBeenLastCalledWith('user_notifications:user', 0, 1_000);
    expect(client.expire).toHaveBeenCalledTimes(2);
    vi.setSystemTime(3_601_000);
    expect(await store.countRecentNotifications('user', -Infinity, Infinity)).toBe(0);
  });
});
