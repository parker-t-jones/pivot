import type { Redis } from '@upstash/redis';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import { GAME_STATE_KEY_TTL_SECONDS, RedisGameStateProvider } from './redisGameStateProvider.js';
import { serializeGameState } from './redisSerde.js';

const STATE: GameState = {
  gameId: 'g1',
  homeTeamId: 'home',
  awayTeamId: 'away',
  possessionTeamId: null,
  unitOnField: 'none',
  scoreHome: 0,
  scoreAway: 0,
  quarter: 1,
  timeRemainingSec: 900,
  yardsToOpponentEndzone: null,
  down: null,
  distance: null,
  inRedZone: false,
  status: 'in_progress',
  updatedAt: 1,
};

describe('RedisGameStateProvider', () => {
  it('sets the game_state hash and refreshes its TTL in one MULTI on every write', async () => {
    const transactions: unknown[][][] = [];
    const redis = {
      multi: () => {
        const queued: unknown[][] = [];
        transactions.push(queued);
        const chain = {
          hset: (...args: unknown[]) => {
            queued.push(['hset', ...args]);
            return chain;
          },
          expire: (...args: unknown[]) => {
            queued.push(['expire', ...args]);
            return chain;
          },
          exec: () => {
            queued.push(['exec']);
            return Promise.resolve([1, 1]);
          },
        };
        return chain;
      },
    } as unknown as Redis;
    const provider = new RedisGameStateProvider(redis);

    await provider.setGameState('g1', STATE);
    await provider.setGameState('g1', { ...STATE, quarter: 2 });

    expect(transactions).toEqual([
      [
        ['hset', 'game_state:g1', serializeGameState(STATE)],
        ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
        ['exec'],
      ],
      [
        ['hset', 'game_state:g1', serializeGameState({ ...STATE, quarter: 2 })],
        ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
        ['exec'],
      ],
    ]);
  });
});

function recordingRedis() {
  const keys: string[] = [];
  const redis = {
    zscore: async (key: string) => {
      keys.push(`zscore ${key}`);
      return null;
    },
    zrange: async (key: string) => {
      keys.push(`zrange ${key}`);
      return [];
    },
    hgetall: async (key: string) => {
      keys.push(`hgetall ${key}`);
      return null;
    },
    zremrangebyscore: async (key: string) => {
      keys.push(`zremrangebyscore ${key}`);
      return 0;
    },
    zadd: async (key: string) => {
      keys.push(`zadd ${key}`);
      return 1;
    },
    hset: async (key: string) => {
      keys.push(`hset ${key}`);
      return 1;
    },
    hdel: async (key: string) => {
      keys.push(`hdel ${key}`);
      return 0;
    },
    pexpire: async (key: string) => {
      keys.push(`pexpire ${key}`);
      return 1;
    },
    del: async (key: string) => {
      keys.push(`del ${key}`);
      return 1;
    },
    zrem: async (key: string) => {
      keys.push(`zrem ${key}`);
      return 0;
    },
  };
  return { redis: redis as unknown as Redis, keys };
}

describe('RedisGameStateProvider presence lookups', () => {
  it('does not scan active_users or another user when checking one device', async () => {
    const { redis, keys } = recordingRedis();
    const provider = new RedisGameStateProvider(redis);
    const userId = 'user-a';

    expect(await provider.isUserActive(userId)).toBe(false);
    expect(await provider.isDeviceActive(userId, '11111111-1111-4111-8111-111111111111')).toBe(false);

    expect(keys).toContain('zscore active_users');
    expect(keys.some((key) => key.includes('zrange active_users'))).toBe(false);
    expect(keys.some((key) => key.includes('user-b'))).toBe(false);
    expect(keys.filter((key) => key.startsWith('zrange '))).toEqual([
      'zrange presence:user-a',
      'zrange presence:user-a',
    ]);
  });

  it('writes the per-user key and its visibility hash, not active_users', async () => {
    const { redis, keys } = recordingRedis();
    const provider = new RedisGameStateProvider(redis);
    await provider.markConnectionActive(
      {
        userId: 'user-a',
        deviceId: '11111111-1111-4111-8111-111111111111',
        connectionId: 'c1',
        platform: 'web',
        visibility: 'hidden',
      },
      60_000,
    );

    expect(keys.some((key) => key.includes('active_users'))).toBe(false);
    expect(keys).toContain('zremrangebyscore presence:user-a');
    expect(keys).toContain('hset presence-vis:user-a');
    expect(keys).toContain('zadd presence:user-a');
    expect(keys).toContain('pexpire presence:user-a');
    expect(keys).toContain('pexpire presence-vis:user-a');
    expect(keys.indexOf('hset presence-vis:user-a')).toBeLessThan(keys.indexOf('zadd presence:user-a'));
  });
});
