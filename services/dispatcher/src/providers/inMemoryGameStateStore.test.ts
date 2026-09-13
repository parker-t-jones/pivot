import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlagState, GameState } from '@pivot/shared';
import { InMemoryGameStateStore } from './inMemoryGameStateStore.js';

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g1',
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 10,
    quarter: 2,
    timeRemainingSec: 430,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 4,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['kc-off'] }],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('InMemoryGameStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips game state and flag state', async () => {
    const store = new InMemoryGameStateStore();
    await store.setGameState('g1', makeGameState());
    await store.setUserFlagState('u1', 'g1', makeFlagState());

    expect(await store.getGameState('g1')).toEqual(makeGameState());
    expect(await store.getGameState('missing')).toBeNull();
    expect(await store.getUserFlagState('u1', 'g1')).toEqual(makeFlagState());
    expect(await store.getUserFlagState('u1', 'missing')).toBeNull();
  });

  it('reads stakes seeded per team', async () => {
    const store = new InMemoryGameStateStore();
    store.addStake('KC', 'u1');
    store.addStake('KC', 'u2');
    store.addStake('LV', 'u1');

    expect((await store.getUsersWithStakeIn('KC')).sort()).toEqual(['u1', 'u2']);
    expect(await store.getUsersWithStakeIn('LV')).toEqual(['u1']);
    expect(await store.getUsersWithStakeIn('SF')).toEqual([]);
  });

  it('treats a user as active until the TTL expires', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('u1', 5 * 60 * 1000);

    expect(await store.isUserActive('u1')).toBe(true);
    expect(await store.getActiveUsers()).toEqual(['u1']);

    // Active while now <= expiry (membership is `score >= now`), inactive strictly after.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await store.isUserActive('u1')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(await store.isUserActive('u1')).toBe(false);
    expect(await store.getActiveUsers()).toEqual([]);
  });

  it('removes an active user immediately (disconnect)', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('u1', 5 * 60 * 1000);
    await store.removeActiveUser('u1');
    expect(await store.isUserActive('u1')).toBe(false);
  });

  it('sweeps expired members but keeps live ones', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('short', 1000);
    await store.markUserActive('long', 60_000);

    vi.advanceTimersByTime(2000);
    await store.sweepExpiredActiveUsers();

    expect(await store.isUserActive('short')).toBe(false);
    expect(await store.isUserActive('long')).toBe(true);
  });
});
