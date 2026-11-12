import type { Redis as IoRedis } from 'ioredis';
import type { Redis as UpstashRedis } from '@upstash/redis';
import { describe, expect, it, vi } from 'vitest';
import { TcpLineupCache } from './tcp.js';
import { RedisLineupCache } from './redis.js';
import { InMemoryLineupCache } from './in-memory.js';

/** Stateful fake commands, with multi-page SCAN including an empty non-terminal page. */
function fakeRedis(tcp: boolean) {
  const sets = new Map<string, Set<string>>();
  const keys = new Set<string>();
  const client = {
    sadd: vi.fn(async (key: string, member: string) => {
      keys.add(key);
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return 1;
    }),
    srem: vi.fn(async (key: string, member: string) => {
      sets.get(key)?.delete(member);
      if (sets.get(key)?.size === 0) {
        sets.delete(key);
        keys.delete(key);
      }
      return 1;
    }),
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
    del: vi.fn(async (key: string) => {
      keys.delete(key);
      sets.delete(key);
      return 1;
    }),
    zrem: vi.fn(async (key: string, member: string) => {
      sets.get(key)?.delete(member);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    scan: vi.fn(async (cursor: string, ...args: unknown[]) => {
      const pattern = tcp ? (args[1] as string) : (args[0] as { match: string }).match;
      // Fixture IDs have no glob characters; production helper escapes them separately.
      const matches = [...keys].filter((key) =>
        pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern,
      );
      if (cursor === '0') return [tcp ? '1' : 1, []];
      // One page can repeat keys, as real SCAN may. Cleanup must be idempotent.
      return [tcp ? '0' : 0, [...matches, ...matches]];
    }),
  };
  return { client, sets, keys };
}

describe.each([
  ['TCP', true],
  ['Upstash', false],
] as const)('%s membership cleanup', (_label, tcp) => {
  function harness() {
    const fake = fakeRedis(tcp);
    const cache = tcp
      ? new TcpLineupCache(fake.client as unknown as IoRedis)
      : new RedisLineupCache(fake.client as unknown as UpstashRedis);
    return { ...fake, cache };
  }

  it('repairs legacy team memberships without a snapshot and leaves other users alone', async () => {
    const { client, cache } = harness();
    await cache.addUserStake('old', 'u1');
    await cache.addUserStake('old', 'u2');
    await cache.addUserStake('kept', 'u1');
    await cache.replaceUserStakes('u1', ['kept', 'new']);
    expect(await cache.getUsersWithStake('old')).toEqual(['u2']);
    expect(await cache.getUsersWithStake('kept')).toEqual(['u1']);
    expect(await cache.getUsersWithStake('new')).toEqual(['u1']);
    expect(client.scan).toHaveBeenCalledTimes(2);
    expect(client.expire).not.toHaveBeenCalled();
    await cache.replaceUserStakes('u1', []);
    expect(await cache.getUsersWithStake('kept')).toEqual([]);
    expect(await cache.getUsersWithStake('new')).toEqual([]);
    expect(await cache.getUsersWithStake('old')).toEqual(['u2']);
  });

  it('removes every user-key family and forward membership without reverse indexes, twice safely', async () => {
    const { cache, keys, sets, client } = harness();
    await cache.addUserStake('old', 'u1');
    await cache.addUserStake('old', 'u2');
    await client.sadd('users_with_bet:orphan-game', 'u1');
    await client.sadd('users_with_bet:orphan-game', 'u2');
    await client.sadd('active_users', 'u1');
    await client.sadd('active_users', 'u2');
    const owned = [
      'user_lineup_cache:u1:5',
      'user_lineup_cache:u1:6',
      'user_bet_games:u1:5',
      'user_bet_games:u1:6',
      'user_flag_state:u1:g',
      'user_notifications:u1',
      'presence:u1',
      'presence-vis:u1',
      'slip_import:u1:2026:5',
      'slip_import:u1:2026-11-11',
    ];
    const other = [
      'user_lineup_cache:u2:5',
      'user_flag_state:u2:g',
      'presence:u2',
      'slip_import:u2:2026:5',
      'current_nfl_state',
      'game_state:g',
      'flag_event_queue',
      'stake_fired:s:c',
    ];
    for (const key of [...owned, ...other]) keys.add(key);
    await cache.removeUser('u1');
    await cache.removeUser('u1');
    for (const key of owned) expect(keys.has(key), key).toBe(false);
    for (const key of other) expect(keys.has(key), key).toBe(true);
    expect(await cache.getUsersWithStake('old')).toEqual(['u2']);
    expect(await cache.getUsersWithBet('orphan-game')).toEqual(['u2']);
    expect([...sets.get('active_users')!]).toEqual(['u2']);
    expect(client.expire).not.toHaveBeenCalled();
  });

  it('attempts other families when one family fails', async () => {
    const { cache, client, keys } = harness();
    keys.add('presence:u1');
    await client.sadd('users_with_stake:old', 'u1');
    client.srem.mockRejectedValue(new Error('set unavailable'));
    await expect(cache.removeUser('u1')).rejects.toThrow('Account cache cleanup incomplete');
    expect(keys.has('presence:u1')).toBe(false);
    expect(client.zrem).toHaveBeenCalledWith('active_users', 'u1');
  });
});

it('in-memory cleanup removes all weeks while preserving other users', async () => {
  const cache = new InMemoryLineupCache();
  for (const userId of ['u1', 'u2']) {
    for (const week of [5, 6]) {
      await cache.setLineupCache(userId, week, {
        userId,
        week,
        teamPositions: new Map(),
        playerToTeam: new Map(),
        starPlayerIds: new Set(),
      });
      await cache.addUserBet('game', userId, week);
    }
    await cache.addUserStake('team', userId);
  }
  await cache.removeUser('u1');
  await cache.removeUser('u1');
  for (const week of [5, 6]) {
    expect(await cache.getLineupCache('u1', week)).toBeNull();
    expect(await cache.getUserBetGames('u1', week)).toEqual([]);
    expect(await cache.getLineupCache('u2', week)).not.toBeNull();
  }
  expect(await cache.getUsersWithStake('team')).toEqual(['u2']);
  expect(await cache.getUsersWithBet('game')).toEqual(['u2']);
});
