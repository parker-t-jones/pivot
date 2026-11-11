import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemorySeenPlaySet, SEEN_PLAYS_TTL_SECONDS } from './seenPlays.js';
import { tcpSeenPlays } from './tcpRedis.js';

function fakeRedis() {
  const entries = new Map<string, { members: Set<string>; expiresAt?: number }>();
  function read(key: string) {
    const entry = entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }
  return {
    sadd: vi.fn(async (key: string, member: string) => {
      const entry = read(key) ?? { members: new Set<string>() };
      entry.members.add(member);
      entries.set(key, entry);
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = read(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
    }),
    sismember: async (key: string, member: string) =>
      Number(read(key)?.members.has(member) ?? false),
    smembers: async (key: string) => [...(read(key)?.members ?? [])],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
const TTL = SEEN_PLAYS_TTL_SECONDS * 1000;

describe.each([
  ['TCP', () => tcpSeenPlays(fakeRedis() as unknown as Redis)],
  ['in-memory', () => new InMemorySeenPlaySet()],
])('%s seen-play retention', (_name, make) => {
  it('expires at 48h without reads extending the deadline', async () => {
    const store = make();
    await store.add('game', 'play');
    vi.setSystemTime(TTL - 1);
    expect(await store.has('game', 'play')).toBe(true);
    expect(await store.members('game')).toEqual(new Set(['play']));
    vi.setSystemTime(TTL);
    expect(await store.has('game', 'play')).toBe(false);
    expect(await store.members('game')).toEqual(new Set());
  });
  it('refreshes duplicate writes and does not resurrect expired members', async () => {
    const store = make();
    await store.add('game', 'old');
    await store.add('other', 'isolated');
    vi.setSystemTime(TTL - 1);
    await store.add('game', 'old');
    vi.setSystemTime(TTL);
    expect(await store.has('game', 'old')).toBe(true);
    expect(await store.has('other', 'isolated')).toBe(false);
    vi.setSystemTime(2 * TTL - 1);
    await store.add('game', 'new');
    expect(await store.members('game')).toEqual(new Set(['new']));
  });
});

it('issues EXPIRE on every TCP add, including duplicates', async () => {
  const client = fakeRedis();
  const store = tcpSeenPlays(client as unknown as Redis);
  await store.add('g', 'p');
  await store.add('g', 'p');
  expect(client.expire).toHaveBeenCalledTimes(2);
  expect(client.expire).toHaveBeenCalledWith('espn_seen_plays:g', 172800);
});
