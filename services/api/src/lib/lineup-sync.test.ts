import { describe, expect, it } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';
import { syncLeagueLineup, type LeagueRow } from './lineup-sync.js';

// Guard clauses short-circuit before touching Supabase or the cache, so a stub that throws
// if called is enough to prove they're reached first.
const unusedSupabase = new Proxy(
  {},
  {
    get() {
      throw new Error('supabase should not be called');
    },
  },
) as SupabaseServiceClient;

const unusedLineupCache = new Proxy(
  {},
  {
    get() {
      throw new Error('lineupCache should not be called');
    },
  },
) as Parameters<typeof syncLeagueLineup>[0]['lineupCache'];

function makeLeague(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    id: 'league-1',
    user_id: 'user-1',
    platform: 'sleeper',
    external_league_id: 'ext-league-1',
    external_roster_id: '2',
    ...overrides,
  };
}

describe('syncLeagueLineup', () => {
  it('rejects platforms that do not support sync (manual)', async () => {
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ platform: 'manual' }),
        5,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'sync_not_supported' });
  });

  it('rejects platforms with no registered provider (espn)', async () => {
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ platform: 'espn' }),
        5,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'sync_not_supported' });
  });

  it('rejects a sleeper league missing external_league_id', async () => {
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ external_league_id: null }),
        5,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'league_not_connected' });
  });

  it('rejects a sleeper league missing external_roster_id', async () => {
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ external_roster_id: null }),
        5,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'league_not_connected' });
  });
});
