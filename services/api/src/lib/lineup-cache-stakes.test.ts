import { computeFlagState } from '@pivot/engine';
import type { GameState } from '@pivot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { rebuildUserLineupCache } from './lineup-sync.js';
import { omitByePlayers } from './lineupCacheAssemble.js';
import type { SupabaseServiceClient } from './supabase.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WEEK = 4;
const SEASON = 2026;
const MATCH = '11111111-1111-4111-8111-111111111111';
const FALL = '22222222-2222-4222-8222-222222222222';
const UNWATCHED = '33333333-3333-4333-8333-333333333333';
const PHI = 'team-phi';
const CHI = 'team-chi';
const BYE = 'team-bye';
const GB = 'team-gb';
const NYJ = 'team-nyj';
const WR = 'player-wr';
const DST = 'player-dst';
const BENCH = 'player-bench';
const BYE_PLAYER = 'player-bye';
const FB1 = 'player-fb1';
const FB2 = 'player-fb2';
const FB3 = 'player-fb3';
const UNW = 'player-unwatched';

const PLAYING = new Set([PHI, CHI, GB]);

const READ_ON = { STAKES_READ: '1', STAKES_WRITE: '1' };

interface SlotRow {
  league_id: string;
  week: number;
  player_id: string;
  slot_type: string;
  is_star: boolean;
  team_id: string;
  position: string;
}

interface StakeRow {
  leagueId: string;
  playerId: string;
  season: number;
  week: number;
}

const PLAYERS = [
  { id: WR, team_id: PHI, position: 'WR' },
  { id: DST, team_id: CHI, position: 'DEF' },
  { id: BENCH, team_id: PHI, position: 'QB' },
  { id: BYE_PLAYER, team_id: BYE, position: 'RB' },
  { id: FB1, team_id: GB, position: 'RB' },
  { id: FB2, team_id: PHI, position: 'TE' },
  { id: FB3, team_id: CHI, position: 'K' },
  { id: UNW, team_id: NYJ, position: 'WR' },
];

const SLOTS: SlotRow[] = [
  {
    league_id: MATCH,
    week: WEEK,
    player_id: WR,
    slot_type: 'starter',
    is_star: true,
    team_id: PHI,
    position: 'WR',
  },
  {
    league_id: MATCH,
    week: WEEK,
    player_id: DST,
    slot_type: 'starter',
    is_star: false,
    team_id: CHI,
    position: 'DEF',
  },
  {
    league_id: MATCH,
    week: WEEK,
    player_id: BYE_PLAYER,
    slot_type: 'starter',
    is_star: false,
    team_id: BYE,
    position: 'RB',
  },
  {
    league_id: MATCH,
    week: WEEK,
    player_id: BENCH,
    slot_type: 'bench',
    is_star: false,
    team_id: PHI,
    position: 'QB',
  },
  {
    league_id: UNWATCHED,
    week: WEEK,
    player_id: UNW,
    slot_type: 'starter',
    is_star: false,
    team_id: NYJ,
    position: 'WR',
  },
];

const STAKES: StakeRow[] = [
  { leagueId: MATCH, playerId: WR, season: SEASON, week: WEEK },
  { leagueId: MATCH, playerId: DST, season: SEASON, week: WEEK },
  { leagueId: FALL, playerId: FB1, season: SEASON, week: WEEK },
  { leagueId: FALL, playerId: FB2, season: SEASON, week: WEEK },
  { leagueId: FALL, playerId: FB3, season: SEASON, week: WEEK },
  { leagueId: UNWATCHED, playerId: UNW, season: SEASON, week: WEEK },
];

const LEAGUES = [
  {
    id: MATCH,
    user_id: USER,
    lineup_source: 'matchup',
    fallback_roster: null,
    season_year: SEASON,
  },
  {
    id: FALL,
    user_id: USER,
    lineup_source: 'roster_fallback',
    fallback_roster: [FB1, FB2, FB3],
    season_year: SEASON,
  },
  {
    id: UNWATCHED,
    user_id: USER,
    lineup_source: 'matchup',
    fallback_roster: null,
    season_year: SEASON,
  },
];

function supabaseFor(stakesError?: string): {
  client: SupabaseServiceClient;
  queried: string[];
} {
  const queried: string[] = [];
  const client = {
    from(table: string) {
      queried.push(table);
      const eq: Record<string, unknown> = {};
      const inn: Record<string, readonly unknown[]> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          eq[column] = value;
          return builder;
        },
        in(column: string, value: readonly unknown[]) {
          inn[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        update() {
          return builder;
        },
        single() {
          return Promise.resolve(materialize(true));
        },
        then(
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(materialize(false)).then(resolve, reject);
        },
      };

      function materialize(single: boolean): { data: unknown; error: unknown } {
        if (table === 'stakes' && stakesError) {
          return { data: null, error: new Error(stakesError) };
        }
        const rows = rowsFor(table, eq, inn);
        if (single) {
          return { data: rows[0] ?? null, error: rows[0] ? null : new Error(`missing ${table}`) };
        }
        return { data: rows, error: null };
      }

      return builder;
    },
  };
  return { client: client as unknown as SupabaseServiceClient, queried };
}

function rowsFor(
  table: string,
  eq: Record<string, unknown>,
  inn: Record<string, readonly unknown[]>,
): unknown[] {
  if (table === 'users') {
    return [
      {
        preferences: { watchedLeagueIds: [MATCH, FALL] },
        subscription_tier: 'pro',
      },
    ];
  }
  if (table === 'leagues') {
    return LEAGUES.filter(
      (league) => eq['user_id'] === undefined || league.user_id === eq['user_id'],
    );
  }
  if (table === 'players') {
    const ids = inn['id'];
    return PLAYERS.filter((player) => ids === undefined || ids.includes(player.id));
  }
  if (table === 'lineup_slots') {
    return SLOTS.filter((slot) => {
      if (eq['league_id'] !== undefined && slot.league_id !== eq['league_id']) return false;
      if (eq['week'] !== undefined && slot.week !== eq['week']) return false;
      const types = inn['slot_type'];
      if (types !== undefined && !types.includes(slot.slot_type)) return false;
      const leagues = inn['league_id'];
      if (leagues !== undefined && !leagues.includes(slot.league_id)) return false;
      const players = inn['player_id'];
      if (players !== undefined && !players.includes(slot.player_id)) return false;
      return true;
    }).map((slot) => ({
      league_id: slot.league_id,
      player_id: slot.player_id,
      is_star: slot.is_star,
      players: { team_id: slot.team_id, position: slot.position },
    }));
  }
  if (table === 'stakes') {
    const leagues = inn['source_ref'];
    return STAKES.filter((stake) => {
      if (eq['user_id'] !== undefined && eq['user_id'] !== USER) return false;
      if (eq['week'] !== undefined && stake.week !== eq['week']) return false;
      if (leagues !== undefined && !leagues.includes(stake.leagueId)) return false;
      return true;
    }).map((stake) => ({
      source_ref: stake.leagueId,
      season: stake.season,
      subject: { type: 'PLAYER', playerId: stake.playerId, teamId: 'stale-team' },
      condition: { type: 'ROSTERED' },
    }));
  }
  throw new Error(`unexpected table ${table}`);
}

async function rebuild(env: NodeJS.ProcessEnv, stakesError?: string) {
  const { client, queried } = supabaseFor(stakesError);
  const lineupCache = new InMemoryLineupCache();
  await rebuildUserLineupCache({ supabase: client, lineupCache }, USER, WEEK, env);
  return { cache: await lineupCache.getLineupCache(USER, WEEK), queried };
}

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game-phi-chi',
    homeTeamId: PHI,
    awayTeamId: CHI,
    possessionTeamId: PHI,
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    timeRemainingSec: 500,
    yardsToOpponentEndzone: 40,
    down: 2,
    distance: 8,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

describe('rebuildUserLineupCache stakes read', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the slot path when STAKES_READ is off', async () => {
    const { cache, queried } = await rebuild({});
    expect(queried).not.toContain('stakes');
    expect(cache?.playerToTeam.get(BYE_PLAYER)).toBe(BYE);
    expect(cache?.playerToTeam.has(BENCH)).toBe(false);
    expect(cache?.playerToTeam.has(UNW)).toBe(false);
  });

  it('matches the slot cache for matchup, fallback, star, D/ST, and an unwatched league', async () => {
    const off = await rebuild({});
    const on = await rebuild(READ_ON);
    const oldCache = off.cache;
    const nextCache = on.cache;
    if (!oldCache || !nextCache) throw new Error('expected both caches');

    const withoutBye = omitByePlayers(oldCache, PLAYING);
    expect(withoutBye.removedPlayerIds).toEqual([BYE_PLAYER]);
    expect(nextCache).toEqual(withoutBye.cache);

    expect(nextCache.playerToTeam.get(WR)).toBe(PHI);
    expect(nextCache.starPlayerIds.has(WR)).toBe(true);
    expect(nextCache.playerUnits?.get(DST)).toBe('defense');
    expect(nextCache.playerToTeam.get(FB1)).toBe(GB);
    expect(nextCache.playerToTeam.get(FB2)).toBe(PHI);
    expect(nextCache.playerToTeam.get(FB3)).toBe(CHI);
    expect(nextCache.starPlayerIds.has(FB1)).toBe(false);
    expect(nextCache.playerToTeam.has(UNW)).toBe(false);
    expect(nextCache.playerToTeam.has(BENCH)).toBe(false);
    expect(nextCache.playerToTeam.has(BYE_PLAYER)).toBe(false);
  });

  it('produces the same flags as the slot cache when the extra player is on a bye', async () => {
    const off = await rebuild({});
    const on = await rebuild(READ_ON);
    const oldCache = off.cache;
    const nextCache = on.cache;
    if (!oldCache || !nextCache) throw new Error('expected both caches');
    expect(nextCache).toEqual(omitByePlayers(oldCache, PLAYING).cache);

    const clock = () => 1;
    const states = [
      game({ possessionTeamId: PHI }),
      game({ possessionTeamId: CHI }),
      game({ possessionTeamId: PHI, inRedZone: true, yardsToOpponentEndzone: 12 }),
      game({
        possessionTeamId: PHI,
        quarter: 4,
        scoreHome: 20,
        scoreAway: 17,
        timeRemainingSec: 90,
      }),
      game({ possessionTeamId: null, unitOnField: 'none', down: null, distance: null }),
    ];
    for (const state of states) {
      expect(computeFlagState(nextCache, state, clock)).toEqual(
        computeFlagState(oldCache, state, clock),
      );
    }
  });

  it('uses lineup_slots when STAKES_READ is on and STAKES_WRITE is not', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { cache, queried } = await rebuild({ STAKES_READ: '1' });
    expect(error).toHaveBeenCalledWith(
      '[stakes] STAKES_READ requires STAKES_WRITE; using lineup_slots',
    );
    expect(queried).not.toContain('stakes');
    expect(cache?.playerToTeam.get(BYE_PLAYER)).toBe(BYE);
  });

  it('falls back to lineup_slots when the stakes read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { cache, queried } = await rebuild(READ_ON, 'db down');
    expect(queried).toContain('stakes');
    expect(error).toHaveBeenCalledWith('[stakes] read failed user=aaaaaaaa err=db down');
    expect(cache?.playerToTeam.get(BYE_PLAYER)).toBe(BYE);
    expect(cache?.playerToTeam.get(WR)).toBe(PHI);
  });
});
