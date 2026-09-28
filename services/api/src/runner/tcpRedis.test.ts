import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { GAME_STATE_KEY_TTL_SECONDS, serializeGameState } from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';
import { tcpGameState } from './tcpRedis.js';

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

describe('tcpGameState', () => {
  it('sets the game_state hash and refreshes its TTL on every write', async () => {
    const calls: unknown[][] = [];
    const redis = {
      hset: (...args: unknown[]) => {
        calls.push(['hset', ...args]);
        return Promise.resolve(1);
      },
      expire: (...args: unknown[]) => {
        calls.push(['expire', ...args]);
        return Promise.resolve(1);
      },
    } as unknown as Redis;
    const store = tcpGameState(redis);

    await store.setGameState('g1', STATE);
    await store.setGameState('g1', { ...STATE, status: 'final' });

    expect(GAME_STATE_KEY_TTL_SECONDS).toBe(6 * 60 * 60);
    expect(calls).toEqual([
      ['hset', 'game_state:g1', serializeGameState(STATE)],
      ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
      ['hset', 'game_state:g1', serializeGameState({ ...STATE, status: 'final' })],
      ['expire', 'game_state:g1', GAME_STATE_KEY_TTL_SECONDS],
    ]);
  });
});
