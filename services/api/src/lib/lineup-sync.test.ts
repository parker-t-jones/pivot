import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseServiceClient } from './supabase.js';
import { buildLineupResponse, syncLeagueLineup, type LeagueRow } from './lineup-sync.js';

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
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    platform: 'sleeper',
    external_league_id: 'ext-league-1',
    external_roster_id: '2',
    ...overrides,
  };
}

/** Tables + cache methods needed after sync for `rebuildUserLineupCache`. */
function rebuildAwareLineupCache() {
  return {
    setLineupCache: vi.fn().mockResolvedValue(undefined),
    addUserStake: vi.fn().mockResolvedValue(undefined),
    getLineupCache: vi.fn().mockResolvedValue(null),
    removeUserStake: vi.fn().mockResolvedValue(undefined),
  };
}

const TEST_LEAGUE_ID = '11111111-1111-4111-8111-111111111111';

function usersAndLeaguesForRebuild(
  leagueId = TEST_LEAGUE_ID,
  lineupSource: string | null = 'matchup',
) {
  return {
    users: {
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                preferences: { watchedLeagueIds: [leagueId] },
                subscription_tier: 'free',
              },
              error: null,
            }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    },
    leaguesSelect: {
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: leagueId,
                  lineup_source: lineupSource,
                  fallback_roster: lineupSource === 'roster_fallback' ? ['p-qb', 'p-rb'] : null,
                },
              ],
              error: null,
            }),
        }),
      }),
    },
  };
}

describe('syncLeagueLineup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const lineupCache = rebuildAwareLineupCache();
    const rebuild = usersAndLeaguesForRebuild(TEST_LEAGUE_ID, 'roster_fallback');

    const supabase = {
      from: (table: string) => {
        if (table === 'users') return rebuild.users;
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
            ...rebuild.leaguesSelect,
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
        lineupCache: lineupCache as never,
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
    expect(lineupCache.setLineupCache).toHaveBeenCalledWith(
      'user-1',
      0,
      expect.objectContaining({
        playerToTeam: expect.any(Map),
      }),
    );
    const cacheArg = lineupCache.setLineupCache.mock.calls[0]?.[2] as
      | { playerToTeam: Map<string, string>; teamPositions: Map<string, Set<string>> }
      | undefined;
    expect(cacheArg).toBeDefined();
    expect([...(cacheArg?.playerToTeam.keys() ?? [])].sort()).toEqual(['p-qb', 'p-rb']);
    expect(cacheArg?.teamPositions.size).toBe(2);
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
      syncLeagueLineup({ supabase, lineupCache: unusedLineupCache }, makeLeague(), {
        week: 0,
        displayPhase: 'pre',
      }),
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
    const lineupCache = rebuildAwareLineupCache();
    const rebuild = usersAndLeaguesForRebuild(TEST_LEAGUE_ID, 'roster_fallback');
    // Empty draft — no players in fallback.
    const emptyRebuild = {
      ...rebuild,
      leaguesSelect: {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: TEST_LEAGUE_ID,
                    lineup_source: 'roster_fallback',
                    fallback_roster: [],
                  },
                ],
                error: null,
              }),
          }),
        }),
      },
    };

    const supabase = {
      from: (table: string) => {
        if (table === 'users') return emptyRebuild.users;
        if (table === 'players') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        if (table === 'leagues') {
          return {
            ...emptyRebuild.leaguesSelect,
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
      { supabase, lineupCache: lineupCache as never },
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
    const fetchLineup = vi
      .fn()
      .mockResolvedValue([
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
    const lineupCache = rebuildAwareLineupCache();
    const rebuild = usersAndLeaguesForRebuild(TEST_LEAGUE_ID, 'matchup');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const supabaseWithRefresh = {
      from: (table: string) => {
        if (table === 'users') return rebuild.users;
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
            ...rebuild.leaguesSelect,
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
        lineupCache: lineupCache as never,
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
        league_id: TEST_LEAGUE_ID,
        week: 1,
        player_id: 'p-qb',
        slot_type: 'starter',
        position_in_lineup: 'QB',
      },
    ]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('counts a missing opponent starter in the unresolved log', async () => {
    process.env['STAKES_WRITE'] = '1';
    const fetchLineup = vi.fn().mockResolvedValue({
      slots: [{ externalPlayerId: 'sl-qb', slotType: 'starter', positionInLineup: 'QB' }],
      opponentSlots: [
        { externalPlayerId: 'sl-missing', slotType: 'starter', positionInLineup: 'WR' },
      ],
    });
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchLineup,
      fetchRosterPlayers: vi.fn(),
    });

    const lineupCache = rebuildAwareLineupCache();
    const rebuild = usersAndLeaguesForRebuild(TEST_LEAGUE_ID, 'matchup');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const supabase = {
      from: (table: string) => {
        if (table === 'users') return rebuild.users;
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
            upsert: () => Promise.resolve({ error: null }),
            delete: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => Promise.resolve({ error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'leagues') {
          return {
            ...rebuild.leaguesSelect,
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    try {
      const result = await syncLeagueLineup(
        { supabase, lineupCache: lineupCache as never },
        makeLeague(),
        { week: 1, displayPhase: 'regular' },
      );
      expect(result.lineupSource).toBe('matchup');
      expect(log).toHaveBeenCalledWith(
        `[lineup-sync] unresolved players league=${TEST_LEAGUE_ID.slice(0, 8)} week=1 count=1 ids=sl-missing`,
      );
    } finally {
      delete process.env['STAKES_WRITE'];
      log.mockRestore();
      err.mockRestore();
    }
  });

  it('logs unresolved Sleeper ids on a partial drop and still syncs the rest', async () => {
    const fetchLineup = vi.fn().mockResolvedValue([
      { externalPlayerId: 'sl-qb', slotType: 'starter', positionInLineup: 'QB' },
      { externalPlayerId: 'sl-idp', slotType: 'starter', positionInLineup: 'DB' },
    ]);
    getFantasyProvider.mockReturnValue({
      supportsSync: () => true,
      fetchLineup,
      fetchRosterPlayers: vi.fn(),
    });

    const upserts: unknown[] = [];
    const lineupCache = rebuildAwareLineupCache();
    const rebuild = usersAndLeaguesForRebuild(TEST_LEAGUE_ID, 'matchup');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const supabase = {
      from: (table: string) => {
        if (table === 'users') return rebuild.users;
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
            ...rebuild.leaguesSelect,
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseServiceClient;

    const result = await syncLeagueLineup(
      { supabase, lineupCache: lineupCache as never },
      makeLeague(),
      { week: 1, displayPhase: 'regular' },
    );

    expect(result.slotCount).toBe(1);
    expect(upserts[0]).toEqual([
      {
        league_id: TEST_LEAGUE_ID,
        week: 1,
        player_id: 'p-qb',
        slot_type: 'starter',
        position_in_lineup: 'QB',
      },
    ]);
    expect(log).toHaveBeenCalledWith(
      '[lineup-sync] unresolved players league=11111111 week=1 count=1 ids=sl-idp',
    );
    log.mockRestore();
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
    expect(response.opponent).toBeNull();
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
    expect(response.opponent).toBeNull();
  });

  const ownMatchup = {
    league_id: 'league-1',
    week: 5,
    last_synced_at: null,
    lineup_source: 'matchup',
    regular_season_start: '2026-09-09',
    slots: [
      {
        slot_id: 'slot-1',
        slot_type: 'starter',
        position_in_lineup: 'QB',
        is_star: true,
        player: {
          player_id: 'p-qb',
          first_name: 'Pat',
          last_name: 'Mahomes',
          position: 'QB',
          team: { team_id: 't-kc', abbreviation: 'KC', name: 'Chiefs' },
        },
      },
    ],
  };

  function matchupClient(options: {
    stakes?: unknown[];
    players?: unknown[];
    games?: unknown[];
    onTable?: (table: string) => void;
  }) {
    return {
      from: (table: string) => {
        options.onTable?.(table);
        const data =
          table === 'lineup_slots'
            ? [
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
                    teams: { id: 't-kc', abbreviation: 'KC', name: 'Chiefs' },
                  },
                },
              ]
            : table === 'stakes'
              ? (options.stakes ?? [])
              : table === 'players'
                ? (options.players ?? [])
                : table === 'games'
                  ? (options.games ?? [])
                  : null;
        if (data === null) throw new Error(table);
        const result = { data, error: null };
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          then: (
            resolve: (value: typeof result) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject),
        };
        return query;
      },
    } as unknown as SupabaseServiceClient;
  }

  const sleeperLeague = {
    id: 'league-1',
    last_synced_at: null as string | null,
    lineup_source: 'matchup',
    fallback_roster: null,
    platform: 'sleeper',
    user_id: 'user-1',
    season_year: 2026,
  };

  it('returns null opponent for a manual league without reading stakes', async () => {
    const tables: string[] = [];
    const response = await buildLineupResponse(
      matchupClient({ onTable: (table) => tables.push(table) }),
      { ...sleeperLeague, platform: 'manual' },
      5,
      '2026-09-09',
    );

    expect(tables).toEqual(['lineup_slots']);
    expect(response.opponent).toBeNull();
    const { opponent, ...own } = response;
    expect(opponent).toBeNull();
    expect(own).toEqual(ownMatchup);
  });

  it('returns null opponent when a Sleeper league has no opponent stakes', async () => {
    const response = await buildLineupResponse(
      matchupClient({
        stakes: [
          {
            user_id: 'user-1',
            week: 5,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-10-01T00:00:00Z',
            condition: { type: 'ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-qb' },
          },
        ],
      }),
      sleeperLeague,
      5,
      '2026-09-09',
    );

    expect(response.opponent).toBeNull();
    const { opponent, ...own } = response;
    expect(opponent).toBeNull();
    expect(own).toEqual(ownMatchup);
  });

  it('adds opponent starters from this week’s OPPONENT_ROSTERED stakes', async () => {
    const response = await buildLineupResponse(
      matchupClient({
        stakes: [
          {
            user_id: 'user-1',
            week: 4,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-09-01T00:00:00Z',
            condition: { type: 'OPPONENT_ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-old' },
          },
          {
            user_id: 'other-user',
            week: 5,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-10-01T00:00:00Z',
            condition: { type: 'OPPONENT_ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-other' },
          },
          {
            user_id: 'user-1',
            week: 5,
            season: 2025,
            source_ref: 'league-1',
            created_at: '2026-10-01T00:00:00Z',
            condition: { type: 'OPPONENT_ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-last-year' },
          },
          {
            user_id: 'user-1',
            week: 5,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-10-02T00:00:00Z',
            condition: { type: 'ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-mine' },
          },
          {
            user_id: 'user-1',
            week: 5,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-10-02T00:00:00Z',
            condition: { type: 'OPPONENT_ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-bye' },
          },
          {
            user_id: 'user-1',
            week: 5,
            season: 2026,
            source_ref: 'league-1',
            created_at: '2026-10-01T00:00:00Z',
            condition: { type: 'OPPONENT_ROSTERED' },
            subject: { type: 'PLAYER', playerId: 'p-wr' },
          },
        ],
        players: [
          {
            id: 'p-wr',
            first_name: 'Christian',
            last_name: 'Watson',
            position: 'WR',
            team_id: 't-gb',
            teams: { id: 't-gb', abbreviation: 'GB', name: 'Packers' },
          },
          {
            id: 'p-bye',
            first_name: 'Josh',
            last_name: 'Jacobs',
            position: 'RB',
            team_id: 't-bye',
            teams: { id: 't-bye', abbreviation: 'GB', name: 'Packers' },
          },
        ],
        games: [
          {
            id: 'pre-gb',
            home_team_id: 't-bye',
            away_team_id: 't-other',
            scheduled_start: '2026-08-15T00:00:00Z',
            season_type: 'pre',
          },
          {
            id: 'reg-gb',
            home_team_id: 't-gb',
            away_team_id: 't-chi',
            scheduled_start: '2026-10-12T20:25:00Z',
            season_type: 'regular',
          },
        ],
      }),
      sleeperLeague,
      5,
      '2026-09-09',
    );

    const { opponent, ...own } = response;
    expect(own).toEqual(ownMatchup);
    expect(opponent).toEqual({
      starters: [
        {
          player_id: 'p-wr',
          first_name: 'Christian',
          last_name: 'Watson',
          position: 'WR',
          team: { team_id: 't-gb', abbreviation: 'GB', name: 'Packers' },
          kickoff: '2026-10-12T20:25:00Z',
          bye: false,
        },
        {
          player_id: 'p-bye',
          first_name: 'Josh',
          last_name: 'Jacobs',
          position: 'RB',
          team: { team_id: 't-bye', abbreviation: 'GB', name: 'Packers' },
          kickoff: null,
          bye: true,
        },
      ],
    });
  });
});
