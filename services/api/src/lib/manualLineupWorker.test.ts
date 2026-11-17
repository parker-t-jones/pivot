import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { MemSupabase, type Row } from './memSupabase.test-helper.js';
import type { SupabaseServiceClient } from './supabase.js';

const { refreshLineupCache, writeThroughLeagueStakes } = vi.hoisted(() => ({
  refreshLineupCache: vi.fn(),
  writeThroughLeagueStakes: vi.fn(),
}));
vi.mock('./lineup-sync.js', () => ({ refreshLineupCache }));
vi.mock('./stakesWriteThrough.js', () => ({ writeThroughLeagueStakes }));

const { carryManualLineups } = await import('./manualLineupWorker.js');

const USER = 'user-1';
const DEMO_USER = 'user-demo';
const MANUAL = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';
const SLEEPER = '33333333-3333-4333-8333-333333333333';
const DEMO_MANUAL = '44444444-4444-4444-8444-444444444444';
const QB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

function league(id: string, platform: string, week: number | null, userId = USER): Row {
  return { id, user_id: userId, platform, manual_lineup_week: week, season_year: 2026 };
}

function slot(leagueId: string, week: number): Row {
  return {
    league_id: leagueId,
    week,
    player_id: QB,
    slot_type: 'starter',
    position_in_lineup: 'QB',
    is_star: false,
  };
}

function seed() {
  const mem = new MemSupabase();
  mem.rows('users').push({ id: USER, is_demo: false }, { id: DEMO_USER, is_demo: true });
  mem
    .rows('leagues')
    .push(
      league(MANUAL, 'manual', 10),
      league(CURRENT, 'manual', 11),
      league(SLEEPER, 'sleeper', null),
      league(DEMO_MANUAL, 'manual', 10, DEMO_USER),
    );
  mem
    .rows('lineup_slots')
    .push(slot(MANUAL, 10), slot(CURRENT, 11), slot(SLEEPER, 10), slot(DEMO_MANUAL, 10));
  const deps = {
    supabase: mem as unknown as SupabaseServiceClient,
    lineupCache: new InMemoryLineupCache(),
  };
  return { mem, deps };
}

function weeks(mem: MemSupabase, leagueId: string): unknown[] {
  return mem
    .rows('lineup_slots')
    .filter((row) => row['league_id'] === leagueId)
    .map((row) => row['week']);
}

describe('carryManualLineups', () => {
  beforeEach(() => {
    refreshLineupCache.mockReset();
    writeThroughLeagueStakes.mockReset();
  });

  it('carries a manual lineup into the new week and refreshes its picks and cache', async () => {
    const { mem, deps } = seed();

    const result = await carryManualLineups(deps, 11);

    expect(result).toEqual({ carriedLeagueCount: 1, failedLeagueCount: 0 });
    expect(weeks(mem, MANUAL)).toEqual([10, 11]);
    expect(writeThroughLeagueStakes).toHaveBeenCalledTimes(1);
    expect(writeThroughLeagueStakes).toHaveBeenCalledWith(deps.supabase, MANUAL, 11);
    expect(refreshLineupCache).toHaveBeenCalledTimes(1);
    expect(refreshLineupCache).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ id: MANUAL, user_id: USER }),
      11,
    );
  });

  it('leaves Sleeper leagues, demo accounts, and up-to-date leagues alone', async () => {
    const { mem, deps } = seed();

    await carryManualLineups(deps, 11);

    expect(weeks(mem, SLEEPER)).toEqual([10]);
    expect(weeks(mem, DEMO_MANUAL)).toEqual([10]);
    expect(weeks(mem, CURRENT)).toEqual([11]);
    expect(mem.byId('leagues', DEMO_MANUAL)['manual_lineup_week']).toBe(10);
    expect(mem.byId('leagues', SLEEPER)['manual_lineup_week']).toBeNull();
  });

  it('does nothing on a second tick in the same week', async () => {
    const { deps } = seed();
    await carryManualLineups(deps, 11);
    writeThroughLeagueStakes.mockReset();

    await expect(carryManualLineups(deps, 11)).resolves.toEqual({
      carriedLeagueCount: 0,
      failedLeagueCount: 0,
    });
    expect(writeThroughLeagueStakes).not.toHaveBeenCalled();
  });

  it('counts a failed league and keeps going', async () => {
    const { mem, deps } = seed();
    const second = '55555555-5555-4555-8555-555555555555';
    mem.rows('leagues').push(league(second, 'manual', 10));
    mem.rows('lineup_slots').push(slot(second, 10));
    refreshLineupCache.mockRejectedValueOnce(new Error('cache down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await carryManualLineups(deps, 11);

    expect(result).toEqual({ carriedLeagueCount: 1, failedLeagueCount: 1 });
    expect(weeks(mem, second)).toEqual([10, 11]);
    errorSpy.mockRestore();
  });
});
