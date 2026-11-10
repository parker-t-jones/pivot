import type { Redis as IoRedis } from 'ioredis';
import type { Redis as UpstashRedis } from '@upstash/redis';
import { describe, expect, it } from 'vitest';
import { serializeUserLineupCache, type UserLineupCache } from '@pivot/shared';
import { RedisLineupCache } from './redis.js';
import { TcpLineupCache } from './tcp.js';
import { LINEUP_CACHE_KEY_TTL_SECONDS } from './types.js';

const KEY = 'user_lineup_cache:user-1:5';
const DAY_MS = 24 * 60 * 60 * 1000;

function makeLineupCache(): UserLineupCache {
  return {
    userId: 'user-1',
    week: 5,
    teamPositions: new Map([['IND', new Set(['offense'])]]),
    playerToTeam: new Map([['player-1', 'IND']]),
    starPlayerIds: new Set(['player-1']),
  };
}

/** A manual clock plus a key store that honors expiry, standing in for Redis. */
function fakeStore() {
  const clock = { now: 0 };
  const entries = new Map<string, { value: unknown; expiresAt: number | null }>();
  const put = (key: string, value: unknown, ttlSec: number | undefined) => {
    entries.set(key, {
      value,
      expiresAt: ttlSec === undefined ? null : clock.now + ttlSec * 1000,
    });
  };
  const read = (key: string): unknown => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && clock.now >= entry.expiresAt) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  };
  return { clock, entries, put, read };
}

function tcpHarness() {
  const store = fakeStore();
  const redis = {
    set: async (key: string, value: string, mode?: string, ttl?: number) => {
      store.put(key, value, mode === 'EX' ? ttl : undefined);
      return 'OK';
    },
    get: async (key: string) => store.read(key),
  } as unknown as IoRedis;
  return { store, cache: new TcpLineupCache(redis) };
}

function upstashHarness() {
  const store = fakeStore();
  const redis = {
    set: async (key: string, value: unknown, options?: { ex?: number }) => {
      store.put(key, value, options?.ex);
      return 'OK';
    },
    get: async (key: string) => store.read(key),
  } as unknown as UpstashRedis;
  return { store, cache: new RedisLineupCache(redis) };
}

describe('lineup cache TTL constant', () => {
  it('is pinned at 14 days so a later edit cannot silently drop or shorten it', () => {
    expect(LINEUP_CACHE_KEY_TTL_SECONDS).toBe(14 * 24 * 60 * 60);
    // Must outlive a full NFL week, or a current-week cache could expire mid-week.
    expect(LINEUP_CACHE_KEY_TTL_SECONDS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
  });
});

describe.each([
  ['TcpLineupCache (ioredis)', tcpHarness],
  ['RedisLineupCache (Upstash)', upstashHarness],
])('%s lineup cache expiry', (_name, harness) => {
  it('writes the key with the TTL and still reads it back before expiry', async () => {
    const { store, cache } = harness();
    await cache.setLineupCache('user-1', 5, makeLineupCache());

    expect(store.entries.get(KEY)?.expiresAt).toBe(LINEUP_CACHE_KEY_TTL_SECONDS * 1000);

    store.clock.now = 13 * DAY_MS;
    expect(await cache.getLineupCache('user-1', 5)).toEqual(makeLineupCache());
  });

  it('refreshes the TTL on every rewrite so a rebuilt cache keeps its key', async () => {
    const { store, cache } = harness();
    await cache.setLineupCache('user-1', 5, makeLineupCache());

    store.clock.now = 10 * DAY_MS;
    await cache.setLineupCache('user-1', 5, makeLineupCache());
    expect(store.entries.get(KEY)?.expiresAt).toBe(
      10 * DAY_MS + LINEUP_CACHE_KEY_TTL_SECONDS * 1000,
    );

    // Past the first write's expiry, but inside the refreshed one.
    store.clock.now = 20 * DAY_MS;
    expect(await cache.getLineupCache('user-1', 5)).toEqual(makeLineupCache());
  });

  it('lets an old week go away once the TTL has passed', async () => {
    const { store, cache } = harness();
    await cache.setLineupCache('user-1', 5, makeLineupCache());

    store.clock.now = 14 * DAY_MS + 1;
    expect(await cache.getLineupCache('user-1', 5)).toBeNull();
    expect(store.entries.has(KEY)).toBe(false);
  });
});

describe('lineup cache serialization is unchanged', () => {
  it('ioredis stores the same JSON string as before', async () => {
    const { store, cache } = tcpHarness();
    await cache.setLineupCache('user-1', 5, makeLineupCache());
    expect(store.entries.get(KEY)?.value).toBe(
      JSON.stringify(serializeUserLineupCache(makeLineupCache())),
    );
  });

  it('Upstash stores the same serialized object as before', async () => {
    const { store, cache } = upstashHarness();
    await cache.setLineupCache('user-1', 5, makeLineupCache());
    expect(store.entries.get(KEY)?.value).toEqual(serializeUserLineupCache(makeLineupCache()));
  });
});
