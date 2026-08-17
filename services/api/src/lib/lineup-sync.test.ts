import { describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';
import {
  buildLineupResponse,
  syncLeagueLineup,
  type LeagueRow,
} from './lineup-sync.js';

const { getFantasyProvider } = vi.hoisted(() => ({
  getFantasyProvider: vi.fn(),
}));

vi.mock('../providers/index.js', () => ({ getFantasyProvider }));

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
    getFantasyProvider.mockReturnValue({
      supportsSync: () => false,
    });
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ platform: 'manual' }),
        { week: 5, displayPhase: 'regular' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'sync_not_supported' });
  });

  it('rejects platforms with no registered provider (espn)', async () => {
    getFantasyProvider.mockReturnValue(null);
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ platform: 'espn' }),
        { week: 5, displayPhase: 'regular' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'sync_not_supported' });
  });

  it('rejects a sleeper league missing external_league_id', async () => {
    getFantasyProvider.mockReturnValue({ supportsSync: () => true });
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ external_league_id: null }),
        { week: 5, displayPhase: 'regular' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'league_not_connected' });
  });

  it('rejects a sleeper league missing external_roster_id', async () => {
    getFantasyProvider.mockReturnValue({ supportsSync: () => true });
    await expect(
      syncLeagueLineup(
        { supabase: unusedSupabase, lineupCache: unusedLineupCache },
        makeLeague({ external_roster_id: null }),
        { week: 5, displayPhase: 'regular' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'league_not_connected' });
  });

  it('off/pre uses fetchRosterPlayers and writes fallback_roster, not lineup_slots', async () => {
    const fetchRosterPlayers = vi.fn().mockResolvedValue(['sl-qb', 'sl-rb']);
    const fetchLineup = vi.fn();
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchRosterPlayers,
      fetchLineup,
    });

    const leagueUpdates: unknown[] = [];
    const setLineupCache = vi.fn().mockResolvedValue(undefined);
    const addUserStake = vi.fn().mockResolvedValue(undefined);

    const supabase = {
      from: (table: string) => {
        if (table === 'players') {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    { id: 'p-qb', sleeper_id: 'sl-qb', team_id: 't1', position: 'QB' },
                    { id: 'p-rb', sleeper_id: 'sl-rb', team_id: 't2', position: 'RB' },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'leagues') {
          return {
            update: (payload: unknown) => {
              leagueUpdates.push(payload);
              return {
                eq: () => Promise.resolve({ error: null }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    const result = await syncLeagueLineup(
      {
        supabase,
        lineupCache: { setLineupCache, addUserStake } as never,
      },
      makeLeague(),
      { week: 0, displayPhase: 'pre' },
    );

    expect(fetchRosterPlayers).toHaveBeenCalledWith({
      externalLeagueId: 'ext-league-1',
      externalRosterId: '2',
    });
    expect(fetchLineup).not.toHaveBeenCalled();
    expect(result).toEqual({
      slotCount: 2,
      lineupSource: 'roster_fallback',
      week: 0,
    });
    expect(leagueUpdates[0]).toMatchObject({
      lineup_source: 'roster_fallback',
      fallback_roster: ['p-qb', 'p-rb'],
    });
    expect(setLineupCache).toHaveBeenCalledWith(
      'user-1',
      0,
      expect.objectContaining({
        playerToTeam: expect.any(Map),
      }),
    );
    const cacheArg = setLineupCache.mock.calls[0]?.[2] as
      | { playerToTeam: Map<string, string>; teamPositions: Map<string, Set<string>> }
      | undefined;
    expect(cacheArg).toBeDefined();
    // Every fallback player is startable (both in the cache).
    expect([...cacheArg!.playerToTeam.keys()].sort()).toEqual(['p-qb', 'p-rb']);
    expect(cacheArg!.teamPositions.size).toBe(2);
  });

  it('fails loud when roster IDs resolve to zero seeded players', async () => {
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchRosterPlayers: vi.fn().mockResolvedValue(['sl-qb', 'sl-rb']),
      fetchLineup: vi.fn(),
    });

    const supabase = {
      from: (table: string) => {
        if (table === 'players') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    await expect(
      syncLeagueLineup(
        { supabase, lineupCache: unusedLineupCache },
        makeLeague(),
        { week: 0, displayPhase: 'pre' },
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'players_not_seeded',
      details: { external_count: 2, resolved_count: 0 },
    });
  });

  it('allows empty external roster (true empty draft) without players_not_seeded', async () => {
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchRosterPlayers: vi.fn().mockResolvedValue([]),
      fetchLineup: vi.fn(),
    });

    const leagueUpdates: unknown[] = [];
    const setLineupCache = vi.fn().mockResolvedValue(undefined);
    const addUserStake = vi.fn().mockResolvedValue(undefined);
    const supabase = {
      from: (table: string) => {
        if (table === 'players') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        if (table === 'leagues') {
          return {
            update: (payload: unknown) => {
              leagueUpdates.push(payload);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    const result = await syncLeagueLineup(
      { supabase, lineupCache: { setLineupCache, addUserStake } as never },
      makeLeague(),
      { week: 0, displayPhase: 'off' },
    );

    expect(result).toEqual({
      slotCount: 0,
      lineupSource: 'roster_fallback',
      week: 0,
    });
    expect(leagueUpdates[0]).toMatchObject({ fallback_roster: [] });
  });

  it('regular uses fetchLineup and clears fallback_roster', async () => {
    const fetchLineup = vi.fn().mockResolvedValue([
      { externalPlayerId: 'sl-qb', slotType: 'starter', positionInLineup: 'QB' },
    ]);
    const fetchRosterPlayers = vi.fn();
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchLineup,
      fetchRosterPlayers,
    });

    const leagueUpdates: unknown[] = [];
    const upserts: unknown[] = [];
    const setLineupCache = vi.fn().mockResolvedValue(undefined);
    const addUserStake = vi.fn().mockResolvedValue(undefined);

    const supabaseWithRefresh = {
      from: (table: string) => {
        if (table === 'players') {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [{ id: 'p-qb', sleeper_id: 'sl-qb', team_id: 't1', position: 'QB' }],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'lineup_slots') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => {
                  const existing = Promise.resolve({ data: [], error: null });
                  return Object.assign(existing, {
                    in: () =>
                      Promise.resolve({
                        data: [
                          {
                            player_id: 'p-qb',
                            is_star: false,
                            players: { team_id: 't1', position: 'QB' },
                          },
                        ],
                        error: null,
                      }),
                  });
                },
              }),
            }),
            upsert: (rows: unknown) => {
              upserts.push(rows);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === 'leagues') {
          return {
            update: (payload: unknown) => {
              leagueUpdates.push(payload);
              return {
                eq: () => Promise.resolve({ error: null }),
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    const result = await syncLeagueLineup(
      {
        supabase: supabaseWithRefresh,
        lineupCache: { setLineupCache, addUserStake } as never,
      },
      makeLeague(),
      { week: 1, displayPhase: 'regular' },
    );

    expect(fetchLineup).toHaveBeenCalled();
    expect(fetchRosterPlayers).not.toHaveBeenCalled();
    expect(result.lineupSource).toBe('matchup');
    expect(leagueUpdates[0]).toMatchObject({
      lineup_source: 'matchup',
      fallback_roster: null,
    });
    expect(upserts[0]).toEqual([
      {
        league_id: 'league-1',
        week: 1,
        player_id: 'p-qb',
        slot_type: 'starter',
        position_in_lineup: 'QB',
      },
    ]);
  });
});

describe('buildLineupResponse', () => {
  it('composes slots from fallback_roster when lineup_source is roster_fallback', async () => {
    const supabase = {
      from: (table: string) => {
        if (table !== 'players') throw new Error(table);
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'p-qb',
                    first_name: 'Pat',
                    last_name: 'Mahomes',
                    position: 'QB',
                    teams: { id: 't1', abbreviation: 'KC', name: 'Chiefs' },
                  },
                ],
                error: null,
              }),
          }),
        };
      },
    } as unknown as SupabaseServiceClient;

    const response = await buildLineupResponse(
      supabase,
      {
        id: 'league-1',
        last_synced_at: '2026-08-15T12:00:00Z',
        lineup_source: 'roster_fallback',
        fallback_roster: ['p-qb'],
      },
      0,
      '2026-09-09',
    );

    expect(response).toMatchObject({
      league_id: 'league-1',
      week: 0,
      lineup_source: 'roster_fallback',
      regular_season_start: '2026-09-09',
      slots: [
        {
          slot_id: 'p-qb',
          slot_type: 'starter',
          position_in_lineup: 'QB',
          is_star: false,
          player: {
            player_id: 'p-qb',
            first_name: 'Pat',
            last_name: 'Mahomes',
            position: 'QB',
          },
        },
      ],
    });
  });

  it('reads lineup_slots when lineup_source is matchup', async () => {
    const supabase = {
      from: (table: string) => {
        if (table !== 'lineup_slots') throw new Error(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'slot-1',
                        slot_type: 'starter',
                        position_in_lineup: 'QB',
                        is_star: true,
                        players: {
                          id: 'p-qb',
                          first_name: 'Pat',
                          last_name: 'Mahomes',
                          position: 'QB',
                          teams: { id: 't1', abbreviation: 'KC', name: 'Chiefs' },
                        },
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      },
    } as unknown as SupabaseServiceClient;

    const response = await buildLineupResponse(
      supabase,
      {
        id: 'league-1',
        last_synced_at: null,
        lineup_source: 'matchup',
        fallback_roster: null,
      },
      3,
      '2026-09-09',
    );

    expect(response.lineup_source).toBe('matchup');
    expect(response.slots[0]?.slot_id).toBe('slot-1');
    expect(response.slots[0]?.is_star).toBe(true);
    expect(response.regular_season_start).toBe('2026-09-09');
  });
});
