import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { getCurrentNflState } from './nfl-state.js';
import { fakeNflStateSource, unreachableNflStateSource } from './nflStateSource.test-helper.js';

describe('getCurrentNflState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through a missing season_start_date as null', async () => {
    const nflStateSource = fakeNflStateSource({ week: 0, season_type: 'off' });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState({ lineupCache: cache, nflStateSource });
    expect(state.seasonStartDate).toBeNull();
  });

  it('passes through an empty season_start_date as null', async () => {
    const nflStateSource = fakeNflStateSource({
      week: 0,
      season_type: 'off',
      season_start_date: '',
    });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState({ lineupCache: cache, nflStateSource });
    expect(state.seasonStartDate).toBeNull();
  });

  it('stores a non-null season_start_date when the source provides one', async () => {
    const nflStateSource = fakeNflStateSource({
      week: 1,
      season_type: 'regular',
      season_start_date: '2026-09-10',
    });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState({ lineupCache: cache, nflStateSource });
    expect(state).toEqual({
      season: '2026',
      week: 1,
      seasonType: 'regular',
      seasonStartDate: '2026-09-10',
    });
  });

  it('serves a cached state without calling the source', async () => {
    const cache = new InMemoryLineupCache();
    await cache.setNflState(
      { season: '2026', week: 9, seasonType: 'regular', seasonStartDate: null },
      300,
    );
    const state = await getCurrentNflState({
      lineupCache: cache,
      nflStateSource: unreachableNflStateSource,
    });
    expect(state.week).toBe(9);
  });

  it('caches the fetched state for five minutes, then reads the source again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T18:00:00Z'));
    const nflStateSource = fakeNflStateSource({ week: 10 });
    const cache = new InMemoryLineupCache();

    await getCurrentNflState({ lineupCache: cache, nflStateSource });
    await getCurrentNflState({ lineupCache: cache, nflStateSource });
    expect(nflStateSource.getNflState).toHaveBeenCalledTimes(1);
    expect((await cache.getNflState())?.week).toBe(10);

    vi.setSystemTime(new Date('2026-11-09T18:05:01Z'));
    await getCurrentNflState({ lineupCache: cache, nflStateSource });
    expect(nflStateSource.getNflState).toHaveBeenCalledTimes(2);
  });

  it('surfaces a source failure on a cache miss instead of inventing a state', async () => {
    const cache = new InMemoryLineupCache();
    await expect(
      getCurrentNflState({ lineupCache: cache, nflStateSource: unreachableNflStateSource }),
    ).rejects.toThrow(/NFL-state source/);
    expect(await cache.getNflState()).toBeNull();
  });
});
