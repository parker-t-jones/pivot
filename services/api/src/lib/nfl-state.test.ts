import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { sleeperClient } from '../providers/sleeper-client.js';
import { getCurrentNflState } from './nfl-state.js';

describe('getCurrentNflState', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through a missing season_start_date as null', async () => {
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue({
      week: 0,
      season: '2026',
      previous_season: '2025',
      season_type: 'off',
    });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState(cache);
    expect(state.seasonStartDate).toBeNull();
  });

  it('passes through an empty season_start_date as null', async () => {
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue({
      week: 0,
      season: '2026',
      previous_season: '2025',
      season_type: 'off',
      season_start_date: '',
    });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState(cache);
    expect(state.seasonStartDate).toBeNull();
  });

  it('stores a non-null season_start_date when Sleeper provides one', async () => {
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue({
      week: 1,
      season: '2026',
      previous_season: '2025',
      season_type: 'regular',
      season_start_date: '2026-09-10',
    });
    const cache = new InMemoryLineupCache();
    const state = await getCurrentNflState(cache);
    expect(state).toEqual({
      season: '2026',
      week: 1,
      seasonType: 'regular',
      seasonStartDate: '2026-09-10',
    });
  });
});
