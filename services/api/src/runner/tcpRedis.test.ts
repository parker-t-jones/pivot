import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { GAME_STATE_KEY_TTL_SECONDS, serializeGameState } from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';
import { createTcpRedis, tcpGameState } from './tcpRedis.js';

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

/** Records each MULTI as one entry: the queued commands, ending in `exec`. */
function fakeRedis(
  execResults: [Error | null, unknown][] = [
    [null, 1],
    [null, 1],
  ],
): { redis: Redis; transactions: unknown[][][] } {
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
          return Promise.resolve(execResults);
        },
      };
      return chain;
    },
  } as unknown as Redis;
  return { redis, transactions };
}

describe('tcpGameState', () => {
  it('sets the game_state hash and refreshes its TTL in one MULTI on every write', async () => {
    const { redis, transactions } = fakeRedis();
    const store = tcpGameState(redis);

    await store.setGameState('g1', STATE);
    await store.setGameState('g1', { ...STATE, status: 'final' });

    expect(GAME_STATE_KEY_TTL_SECONDS).toBe(6 * 60 * 60);
    expect(transactions).toEqual([
      [
        ['hset', 'game_state:g1', serializeGameState(STATE)],
        ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
        ['exec'],
      ],
      [
        ['hset', 'game_state:g1', serializeGameState({ ...STATE, status: 'final' })],
        ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
        ['exec'],
      ],
    ]);
  });

  it('rejects when a command inside the MULTI fails', async () => {
    const { redis } = fakeRedis([
      [new Error('WRONGTYPE'), null],
      [null, 1],
    ]);

    await expect(tcpGameState(redis).setGameState('g1', STATE)).rejects.toThrow('WRONGTYPE');
  });
});

describe('createTcpRedis address family', () => {
  // Fly's private network is IPv6-only; production REDIS_URL carries `?family=6`.
  function familyFor(url: string): unknown {
    const redis = createTcpRedis(url, 'test');
    redis.disconnect();
    return redis.options.family;
  }

  it('uses IPv6 for the Fly .internal URL', () => {
    expect(familyFor('redis://default:pw@pivot-sports-redis.internal:6379?family=6')).toBe(6);
  });

  it('leaves local Docker URLs on the default lookup', () => {
    expect(familyFor('redis://localhost:6379')).not.toBe(6);
    expect(familyFor('redis://127.0.0.1:6379')).not.toBe(6);
  });
});
