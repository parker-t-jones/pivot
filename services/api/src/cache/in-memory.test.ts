import { describe, expect, it, vi } from 'vitest';
import type { UserLineupCache } from '@roster-remote/shared';
import { InMemoryLineupCache } from './in-memory.js';

function makeLineupCache(overrides: Partial<UserLineupCache> = {}): UserLineupCache {
  return {
    userId: 'user-1',
    week: 5,
    teamPositions: new Map([['IND', new Set(['offense'])]]),
    playerToTeam: new Map([['player-1', 'IND']]),
    starPlayerIds: new Set(['player-1']),
    ...overrides,
  };
}

describe('InMemoryLineupCache', () => {
  it('returns null for a lineup cache that was never set', async () => {
    const cache = new InMemoryLineupCache();
    expect(await cache.getLineupCache('user-1', 5)).toBeNull();
  });

  it('round-trips a lineup cache keyed by user and week', async () => {
    const cache = new InMemoryLineupCache();
    const lineup = makeLineupCache();
    await cache.setLineupCache('user-1', 5, lineup);

    expect(await cache.getLineupCache('user-1', 5)).toBe(lineup);
    expect(await cache.getLineupCache('user-1', 6)).toBeNull();
    expect(await cache.getLineupCache('user-2', 5)).toBeNull();
  });

  it('tracks user stakes per team, additively and removably', async () => {
    const cache = new InMemoryLineupCache();
    await cache.addUserStake('IND', 'user-1');
    await cache.addUserStake('IND', 'user-2');
    await cache.addUserStake('BAL', 'user-1');

    expect(await cache.getUsersWithStake('IND')).toEqual(
      expect.arrayContaining(['user-1', 'user-2']),
    );
    expect(await cache.getUsersWithStake('BAL')).toEqual(['user-1']);

    await cache.removeUserStake('IND', 'user-1');
    expect(await cache.getUsersWithStake('IND')).toEqual(['user-2']);
  });

  it('returns an empty array for a team with no stakeholders', async () => {
    const cache = new InMemoryLineupCache();
    expect(await cache.getUsersWithStake('IND')).toEqual([]);
  });

  it('returns null for NFL state before it is set', async () => {
    const cache = new InMemoryLineupCache();
    expect(await cache.getNflState()).toBeNull();
  });

  it('expires NFL state after its TTL', async () => {
    vi.useFakeTimers();
    const cache = new InMemoryLineupCache();
    const state = {
      season: '2026',
      week: 5,
      seasonType: 'regular' as const,
      seasonStartDate: null,
    };
    await cache.setNflState(state, 300);

    expect(await cache.getNflState()).toEqual(state);
    vi.advanceTimersByTime(300 * 1000 + 1);
    expect(await cache.getNflState()).toBeNull();
    vi.useRealTimers();
  });
});
