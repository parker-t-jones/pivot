import type { Redis as IoRedis } from 'ioredis';
import type { Redis as UpstashRedis } from '@upstash/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from './in-memory.js';
import { RedisLineupCache } from './redis.js';
import { TcpLineupCache } from './tcp.js';
import { LINEUP_CACHE_KEY_TTL_SECONDS } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const TTL = LINEUP_CACHE_KEY_TTL_SECONDS * 1000;
const KEYS = ['users_with_bet:game-1', 'user_bet_games:user-1:5'] as const;

/** Redis set semantics: SADD/SREM preserve expiry; removing the last member deletes the key. */
function fakeClient() {
  const entries = new Map<string, { members: Set<string>; expiresAt?: number }>();
  function read(key: string) {
    const entry = entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }
  const client = {
    sadd: vi.fn(async (key: string, member: string) => {
      const entry = read(key) ?? { members: new Set<string>() };
      entry.members.add(member);
      entries.set(key, entry);
      return 1;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = read(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }),
    srem: vi.fn(async (key: string, member: string) => {
      const entry = read(key);
      entry?.members.delete(member);
      if (entry?.members.size === 0) entries.delete(key);
      return 1;
    }),
    smembers: async (key: string) => [...(read(key)?.members ?? [])],
  };
  return { client, entries };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe.each([
  [
    'TCP',
    () => {
      const fake = fakeClient();
      return { ...fake, cache: new TcpLineupCache(fake.client as unknown as IoRedis) };
    },
  ],
  [
    'Upstash',
    () => {
      const fake = fakeClient();
      return { ...fake, cache: new RedisLineupCache(fake.client as unknown as UpstashRedis) };
    },
  ],
])('%s bet index expiry commands', (_name, harness) => {
  it('expires both keys on add and refreshes already-expiring keys on historical-week resync', async () => {
    const { cache, client, entries } = harness();
    await cache.addUserBet('game-1', 'user-1', 5);
    for (const key of KEYS) {
      expect(client.expire).toHaveBeenCalledWith(key, LINEUP_CACHE_KEY_TTL_SECONDS);
      expect(entries.get(key)?.expiresAt).toBe(TTL);
    }
    expect(client.expire).toHaveBeenCalledTimes(2);

    vi.setSystemTime(13 * DAY);
    await cache.addUserBet('game-1', 'user-1', 5);
    expect(client.expire).toHaveBeenCalledTimes(4);
    for (const key of KEYS) expect(entries.get(key)?.expiresAt).toBe(13 * DAY + TTL);
    vi.setSystemTime(14 * DAY);
    expect(await cache.getUsersWithBet('game-1')).toEqual(['user-1']);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual(['game-1']);
  });

  it('removes members without issuing expiry or persistence commands', async () => {
    const { cache, client, entries } = harness();
    await cache.addUserBet('game-1', 'user-1', 5);
    vi.setSystemTime(DAY);
    await cache.addUserBet('game-1', 'user-2', 5);
    await cache.addUserBet('game-2', 'user-1', 5);
    const deadlines = KEYS.map((key) => entries.get(key)?.expiresAt);
    client.expire.mockClear();
    vi.setSystemTime(2 * DAY);
    await cache.removeUserBet('game-1', 'user-1', 5);
    expect(client.srem).toHaveBeenCalledWith(KEYS[0], 'user-1');
    expect(client.srem).toHaveBeenCalledWith(KEYS[1], 'game-1');
    expect(client.expire).not.toHaveBeenCalled();
    expect(KEYS.map((key) => entries.get(key)?.expiresAt)).toEqual(deadlines);
    expect(await cache.getUsersWithBet('game-1')).toEqual(['user-2']);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual(['game-2']);
    await cache.removeUserBet('game-1', 'user-2', 5);
    expect(entries.has(KEYS[0])).toBe(false);
    await cache.removeUserBet('missing', 'missing', 5);
    expect(client.expire).not.toHaveBeenCalled();
  });
});

describe.each([
  ['TCP', () => new TcpLineupCache(fakeClient().client as unknown as IoRedis)],
  ['Upstash', () => new RedisLineupCache(fakeClient().client as unknown as UpstashRedis)],
  ['in-memory', () => new InMemoryLineupCache()],
])('%s bet index TTL behavior', (_name, makeCache) => {
  it('expires both indexes at 14 days', async () => {
    const cache = makeCache();
    await cache.addUserBet('game-1', 'user-1', 5);
    vi.setSystemTime(TTL - 1);
    expect(await cache.getUsersWithBet('game-1')).toEqual(['user-1']);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual(['game-1']);
    vi.setSystemTime(TTL);
    expect(await cache.getUsersWithBet('game-1')).toEqual([]);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual([]);
  });

  it('refreshes on duplicate add during resync and preserves expiry on remove', async () => {
    const cache = makeCache();
    await cache.addUserBet('game-1', 'user-1', 5);
    vi.setSystemTime(13 * DAY);
    await cache.addUserBet('game-1', 'user-1', 5);
    await cache.addUserBet('game-1', 'user-2', 5);
    await cache.addUserBet('game-2', 'user-1', 5);
    vi.setSystemTime(14 * DAY);
    await cache.removeUserBet('game-1', 'user-1', 5);
    expect(await cache.getUsersWithBet('game-1')).toEqual(['user-2']);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual(['game-2']);
    vi.setSystemTime(27 * DAY);
    expect(await cache.getUsersWithBet('game-1')).toEqual([]);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual([]);
  });

  it('does not resurrect expired members when adding again', async () => {
    const cache = makeCache();
    await cache.addUserBet('game-1', 'old-user', 5);
    await cache.addUserBet('old-game', 'user-1', 5);
    vi.setSystemTime(TTL);
    await cache.addUserBet('game-1', 'user-1', 5);
    expect(await cache.getUsersWithBet('game-1')).toEqual(['user-1']);
    expect(await cache.getUserBetGames('user-1', 5)).toEqual(['game-1']);
  });
});
