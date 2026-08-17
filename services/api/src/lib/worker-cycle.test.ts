import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';

const { getLineupSyncContext } = vi.hoisted(() => ({ getLineupSyncContext: vi.fn() }));
const { syncLeagueLineup } = vi.hoisted(() => ({ syncLeagueLineup: vi.fn() }));

vi.mock('./lineup-sync.js', () => ({ getLineupSyncContext, syncLeagueLineup }));

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
    getLineupSyncContext.mockReset();
    syncLeagueLineup.mockReset();
  });

  it('syncs every tick when display_phase is regular, regardless of lastDailySyncAt', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 10,
      displayPhase: 'regular',
      regularSeasonStart: '2026-09-09',
      seasonType: 'regular',
    });
    syncLeagueLineup.mockResolvedValue({ slotCount: 9, lineupSource: 'matchup', week: 10 });
    const supabase = makeSupabase([league('a'), league('b')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: NOON }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(2);
    expect(result.failedLeagueCount).toBe(0);
    expect(syncLeagueLineup).toHaveBeenCalledTimes(2);
    expect(syncLeagueLineup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'a' }),
      { week: 10, displayPhase: 'regular' },
    );
    expect(result.nextState).toEqual({ lastDailySyncAt: NOON });
  });

  it('syncs when display_phase is post', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 19,
      displayPhase: 'post',
      regularSeasonStart: '2026-09-09',
      seasonType: 'post',
    });
    syncLeagueLineup.mockResolvedValue({ slotCount: 9, lineupSource: 'matchup', week: 19 });
    const supabase = makeSupabase([league('a')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(1);
  });

  it('runs the first off-season tick even with no prior sync recorded', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 0,
      displayPhase: 'off',
      regularSeasonStart: '2026-09-09',
      seasonType: 'off',
    });
    syncLeagueLineup.mockResolvedValue({
      slotCount: 12,
      lineupSource: 'roster_fallback',
      week: 0,
    });
    const supabase = makeSupabase([league('a')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.nextState).toEqual({ lastDailySyncAt: NOON });
    expect(syncLeagueLineup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { week: 0, displayPhase: 'off' },
    );
  });

  it('skips an off-season tick within 24h of the last daily sync', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 0,
      displayPhase: 'off',
      regularSeasonStart: '2026-09-09',
      seasonType: 'off',
    });
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
    getLineupSyncContext.mockResolvedValue({
      week: 0,
      displayPhase: 'off',
      regularSeasonStart: '2026-09-09',
      seasonType: 'off',
    });
    syncLeagueLineup.mockResolvedValue({
      slotCount: 0,
      lineupSource: 'roster_fallback',
      week: 0,
    });
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

  it('treats display_phase pre the same as off (sync at most daily)', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 2,
      displayPhase: 'pre',
      regularSeasonStart: '2026-09-09',
      seasonType: 'pre',
    });
    const supabase = makeSupabase([league('a')]);
    const oneHourAgo = NOON - 60 * 60 * 1000;

    const result = await runWorkerCycle(
      { supabase, lineupCache },
      { lastDailySyncAt: oneHourAgo },
      NOON,
    );

    expect(result.ran).toBe(false);
  });

  it('keys cadence on display_phase even when Sleeper season_type already says regular', async () => {
    // Sprint 10: Sleeper season_type can run ahead of schedule-derived display_phase.
    getLineupSyncContext.mockResolvedValue({
      week: 1,
      displayPhase: 'pre',
      regularSeasonStart: '2026-09-09',
      seasonType: 'regular',
    });
    const supabase = makeSupabase([league('a')]);
    const oneHourAgo = NOON - 60 * 60 * 1000;

    const result = await runWorkerCycle(
      { supabase, lineupCache },
      { lastDailySyncAt: oneHourAgo },
      NOON,
    );

    expect(result.ran).toBe(false);
    expect(syncLeagueLineup).not.toHaveBeenCalled();
  });

  it('continues syncing remaining leagues when one fails, and counts it', async () => {
    getLineupSyncContext.mockResolvedValue({
      week: 10,
      displayPhase: 'regular',
      regularSeasonStart: '2026-09-09',
      seasonType: 'regular',
    });
    syncLeagueLineup
      .mockRejectedValueOnce(new Error('sleeper is down'))
      .mockResolvedValueOnce({ slotCount: 9, lineupSource: 'matchup', week: 10 });
    const supabase = makeSupabase([league('a'), league('b')]);

    const result = await runWorkerCycle({ supabase, lineupCache }, { lastDailySyncAt: null }, NOON);

    expect(result.ran).toBe(true);
    expect(result.syncedLeagueCount).toBe(1);
    expect(result.failedLeagueCount).toBe(1);
  });
});
