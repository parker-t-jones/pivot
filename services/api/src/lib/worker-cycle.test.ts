import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';

const { getCurrentNflState } = vi.hoisted(() => ({ getCurrentNflState: vi.fn() }));
const { syncLeagueLineup } = vi.hoisted(() => ({ syncLeagueLineup: vi.fn() }));

vi.mock('./nfl-state.js', () => ({ getCurrentNflState }));
vi.mock('./lineup-sync.js', () => ({ syncLeagueLineup }));

const { runWorkerCycle } = await import('./worker-cycle.js');

interface FakeLeagueRow {
  id: string;
  user_id: string;
  platform: string;
  external_league_id: string | null;
  external_roster_id: string | null;
}

function makeSupabase(leagues: FakeLeagueRow[]): SupabaseServiceClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: leagues, error: null }),
      }),
    }),
  } as unknown as SupabaseServiceClient;
}

const NOON = new Date('2026-11-15T12:00:00Z').getTime();
const league = (id: string): FakeLeagueRow => ({
  id,
  user_id: `user-${id}`,
  platform: 'sleeper',
  external_league_id: `ext-${id}`,
  external_roster_id: '1',
});

describe('runWorkerCycle', () => {
  const lineupCache = {} as never;

  beforeEach(() => {
    getCurrentNflState.mockReset();
    syncLeagueLineup.mockReset();
  });

  it('syncs every tick during the regular season, regardless of lastDailySyncAt', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 10, seasonType: 'regular' });
    syncLeagueLineup.mockResolvedValue({ slotCount: 9 });
    const supabase = makeSupabase([league('a'), league('b')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: NOON }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(2);
    expect(result.failedLeagueCount).toBe(0);
    expect(syncLeagueLineup).toHaveBeenCalledTimes(2);
    expect(result.nextState).toEqual({ lastDailySyncAt: NOON });
  });

  it('syncs during the postseason too', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 19, seasonType: 'post' });
    syncLeagueLineup.mockResolvedValue({ slotCount: 9 });
    const supabase = makeSupabase([league('a')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(1);
  });

  it('runs the first off-season tick even with no prior sync recorded', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 0, seasonType: 'off' });
    syncLeagueLineup.mockResolvedValue({ slotCount: 0 });
    const supabase = makeSupabase([league('a')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.nextState).toEqual({ lastDailySyncAt: NOON });
  });

  it('skips an off-season tick within 24h of the last daily sync', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 0, seasonType: 'off' });
    const supabase = makeSupabase([league('a')]);
    const oneHourAgo = NOON - 60 * 60 * 1000;

    const result = await runWorkerCycle(
      { supabase, lineupCache },
      { lastDailySyncAt: oneHourAgo },
      NOON,
    );

    expect(result.ran).toBe(false);
    expect(result.syncedLeagueCount).toBe(0);
    expect(syncLeagueLineup).not.toHaveBeenCalled();
    expect(result.nextState).toEqual({ lastDailySyncAt: oneHourAgo });
  });

  it('runs an off-season tick again once 24h have elapsed', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 0, seasonType: 'off' });
    syncLeagueLineup.mockResolvedValue({ slotCount: 0 });
    const supabase = makeSupabase([league('a')]);
    const twentyFiveHoursAgo = NOON - 25 * 60 * 60 * 1000;

    const result = await runWorkerCycle(
      { supabase, lineupCache },
      { lastDailySyncAt: twentyFiveHoursAgo },
      NOON,
    );

    expect(result.ran).toBe(true);
    expect(result.nextState).toEqual({ lastDailySyncAt: NOON });
  });

  it('treats preseason the same as off-season (sync at most daily)', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 2, seasonType: 'pre' });
    const supabase = makeSupabase([league('a')]);
    const oneHourAgo = NOON - 60 * 60 * 1000;

    const result = await runWorkerCycle(
      { supabase, lineupCache },
      { lastDailySyncAt: oneHourAgo },
      NOON,
    );

    expect(result.ran).toBe(false);
  });

  it('continues syncing remaining leagues when one fails, and counts it', async () => {
    getCurrentNflState.mockResolvedValue({ season: '2026', week: 10, seasonType: 'regular' });
    syncLeagueLineup
      .mockRejectedValueOnce(new Error('sleeper is down'))
      .mockResolvedValueOnce({ slotCount: 9 });
    const supabase = makeSupabase([league('a'), league('b')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(1);
    expect(result.failedLeagueCount).toBe(1);
  });
});
