import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { DEMO_LEAGUE_ID } from '../lib/demoFixture.js';
import { apiErrorHandler } from '../lib/errors.js';
import { MemSupabase, type Row } from '../lib/memSupabase.test-helper.js';
import { unreachableNflStateSource } from '../lib/nflStateSource.test-helper.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';

// Lineup enrichment and the stake write-through are covered elsewhere. Here they are spies, so
// these tests pin which week the routes carry a manual lineup into and what they refresh.
const lineupSync = vi.hoisted(() => ({
  getLineupSyncContext: vi.fn(),
  buildLineupResponse: vi.fn(),
  refreshLineupCache: vi.fn(),
  rebuildUserLineupCache: vi.fn(),
  syncLeagueLineup: vi.fn(),
}));
const stakesWrite = vi.hoisted(() => ({
  writeThroughLeagueStakes: vi.fn(),
  deleteLeagueStakes: vi.fn(),
}));
vi.mock('../lib/lineup-sync.js', () => lineupSync);
vi.mock('../lib/stakesWriteThrough.js', () => stakesWrite);

const { default: leaguesRoutes } = await import('./leagues.js');

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const DEMO_USER = '3057923d-af10-4bfc-966c-db93341863f3';
const MANUAL = '11111111-1111-4111-8111-111111111111';
const SLEEPER = '22222222-2222-4222-8222-222222222222';
const CHI = 'f2624144-a1b6-4415-bacc-217a25b2aa62';
const PHI = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
const DAL = '0c7d8f3e-6a3b-4a59-9d55-2f6c1e0b7a11';
const NYG = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const BEARS_RB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const COWBOYS_QB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const GIANTS_K = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const CURRENT_WEEK = 11;
// Week 11: CHI @ PHI kicks off at 18:00Z, DAL @ NYG the next night.
const BEFORE_ANY = new Date('2026-11-22T17:00:00.000Z');
const AFTER_EARLY = new Date('2026-11-22T18:30:00.000Z');

function slot(leagueId: string, week: number, playerId: string, position: string): Row {
  return {
    league_id: leagueId,
    week,
    player_id: playerId,
    slot_type: 'starter',
    position_in_lineup: position,
    is_star: false,
  };
}

function seed(tier: 'free' | 'pro' = 'free'): MemSupabase {
  const mem = new MemSupabase();
  mem
    .rows('users')
    .push(
      { id: USER, is_demo: false, subscription_tier: tier },
      { id: DEMO_USER, is_demo: true, subscription_tier: 'free' },
    );
  const league = {
    user_id: USER,
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
    lineup_source: null,
    fallback_roster: null,
  };
  mem
    .rows('leagues')
    .push(
      { ...league, id: MANUAL, platform: 'manual', name: 'Office', manual_lineup_week: 10 },
      { ...league, id: SLEEPER, platform: 'sleeper', name: 'Sleeper', manual_lineup_week: null },
    );
  mem
    .rows('players')
    .push(
      { id: BEARS_RB, team_id: CHI },
      { id: COWBOYS_QB, team_id: DAL },
      { id: GIANTS_K, team_id: NYG },
    );
  const game = {
    season_year: 2026,
    week: CURRENT_WEEK,
    season_type: 'regular',
    status: 'scheduled',
  };
  mem.rows('games').push(
    {
      ...game,
      home_team_id: PHI,
      away_team_id: CHI,
      scheduled_start: '2026-11-22T18:00:00.000Z',
    },
    {
      ...game,
      home_team_id: NYG,
      away_team_id: DAL,
      scheduled_start: '2026-11-24T01:15:00.000Z',
    },
  );
  mem
    .rows('lineup_slots')
    .push(
      slot(MANUAL, 10, BEARS_RB, 'RB1'),
      slot(MANUAL, 10, COWBOYS_QB, 'QB'),
      slot(SLEEPER, 10, GIANTS_K, 'K'),
    );
  return mem;
}

function players(mem: MemSupabase, leagueId: string, week: number): unknown[] {
  return mem
    .rows('lineup_slots')
    .filter((row) => row['league_id'] === leagueId && row['week'] === week)
    .map((row) => row['player_id']);
}

async function signToken(sub: string): Promise<string> {
  return await new SignJWT({ sub, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('manual lineups across a week rollover', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  beforeEach(() => {
    for (const spy of [...Object.values(lineupSync), ...Object.values(stakesWrite)]) {
      spy.mockReset();
    }
    lineupSync.getLineupSyncContext.mockResolvedValue({
      week: CURRENT_WEEK,
      displayPhase: 'regular',
      regularSeasonStart: '2026-09-10',
      seasonType: 'regular',
    });
    lineupSync.buildLineupResponse.mockImplementation(
      (_db: unknown, league: { id: string }, week: number) =>
        Promise.resolve({ league_id: league.id, week, slots: [] }),
    );
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function buildApp(mem: MemSupabase, now: Date = BEFORE_ANY) {
    const lineupCache = new InMemoryLineupCache();
    await lineupCache.setNflState(
      { season: '2026', week: CURRENT_WEEK, seasonType: 'regular', seasonStartDate: '2026-09-10' },
      600,
    );
    const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
    fastify.setErrorHandler(apiErrorHandler);
    await fastify.register(authPlugin, {
      jwtSecret: JWT_SECRET,
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    await fastify.register(servicesPlugin, {
      supabase: mem as unknown as SupabaseServiceClient,
      lineupCache,
      nflStateSource: unreachableNflStateSource,
      gameStateStore: new InMemoryGameStateStore(),
      realtimeSubscriber: new InMemoryRealtimeBus(),
    });
    await fastify.register(leaguesRoutes, { now: () => now });
    return fastify;
  }

  async function getLineup(mem: MemSupabase, leagueId: string, query = '', user = USER) {
    app = await buildApp(mem);
    return await app.inject({
      method: 'GET',
      url: `/leagues/${leagueId}/lineup${query}`,
      headers: { authorization: `Bearer ${await signToken(user)}` },
    });
  }

  async function putLineup(
    mem: MemSupabase,
    playerIds: string[],
    { now = BEFORE_ANY, week = CURRENT_WEEK, user = USER } = {},
  ) {
    app = await buildApp(mem, now);
    return await app.inject({
      method: 'PUT',
      url: `/leagues/${MANUAL}/lineup`,
      headers: { authorization: `Bearer ${await signToken(user)}` },
      payload: {
        week,
        slots: playerIds.map((id, index) => ({
          player_id: id,
          slot_type: 'starter',
          position_in_lineup: `S${index + 1}`,
        })),
      },
    });
  }

  it("shows last week's manual lineup in the new week and refreshes its picks and alerts", async () => {
    const mem = seed();

    const response = await getLineup(mem, MANUAL);

    expect(response.statusCode).toBe(200);
    expect(players(mem, MANUAL, CURRENT_WEEK)).toEqual([BEARS_RB, COWBOYS_QB]);
    expect(players(mem, MANUAL, 10)).toEqual([BEARS_RB, COWBOYS_QB]);
    expect(mem.byId('leagues', MANUAL)['manual_lineup_week']).toBe(CURRENT_WEEK);
    expect(stakesWrite.writeThroughLeagueStakes).toHaveBeenCalledWith(
      expect.anything(),
      MANUAL,
      CURRENT_WEEK,
    );
    expect(lineupSync.refreshLineupCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: MANUAL }),
      CURRENT_WEEK,
    );
    expect(lineupSync.buildLineupResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: MANUAL }),
      CURRENT_WEEK,
      '2026-09-10',
    );
  });

  it('does not carry when browsing a past week', async () => {
    const mem = seed();

    const response = await getLineup(mem, MANUAL, '?week=9');

    expect(response.statusCode).toBe(200);
    expect(players(mem, MANUAL, CURRENT_WEEK)).toEqual([]);
    expect(players(mem, MANUAL, 9)).toEqual([]);
    expect(stakesWrite.writeThroughLeagueStakes).not.toHaveBeenCalled();
  });

  it('leaves a Sleeper lineup to the Sleeper sync', async () => {
    const mem = seed();

    const response = await getLineup(mem, SLEEPER);

    expect(response.statusCode).toBe(200);
    expect(players(mem, SLEEPER, CURRENT_WEEK)).toEqual([]);
    expect(mem.byId('leagues', SLEEPER)['manual_lineup_week']).toBeNull();
    expect(stakesWrite.writeThroughLeagueStakes).not.toHaveBeenCalled();
  });

  it('keeps a player locked once his game starts, even on the first edit of the new week', async () => {
    const mem = seed();

    const response = await putLineup(mem, [COWBOYS_QB, GIANTS_K], { now: AFTER_EARLY });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'lineup_player_locked',
      details: { player_ids: [BEARS_RB] },
    });
    expect(players(mem, MANUAL, CURRENT_WEEK)).toEqual([BEARS_RB, COWBOYS_QB]);
  });

  it('saves an edit before kickoff and records the week', async () => {
    const mem = seed();

    const response = await putLineup(mem, [COWBOYS_QB, GIANTS_K]);

    expect(response.statusCode).toBe(200);
    expect(players(mem, MANUAL, CURRENT_WEEK)).toEqual([COWBOYS_QB, GIANTS_K]);
    expect(players(mem, MANUAL, 10)).toEqual([BEARS_RB, COWBOYS_QB]);
    expect(mem.byId('leagues', MANUAL)['manual_lineup_week']).toBe(CURRENT_WEEK);
  });

  it('keeps a cleared lineup cleared after the next rollover', async () => {
    const mem = seed();
    expect((await putLineup(mem, [])).statusCode).toBe(200);
    await app?.close();
    lineupSync.getLineupSyncContext.mockResolvedValue({
      week: CURRENT_WEEK + 1,
      displayPhase: 'regular',
      regularSeasonStart: '2026-09-10',
      seasonType: 'regular',
    });

    expect((await getLineup(mem, MANUAL)).statusCode).toBe(200);

    expect(players(mem, MANUAL, CURRENT_WEEK + 1)).toEqual([]);
    expect(mem.byId('leagues', MANUAL)['manual_lineup_week']).toBe(CURRENT_WEEK + 1);
  });

  it('still enforces the free player cap with a 403 code', async () => {
    const mem = seed();
    const ten = Array.from(
      { length: 10 },
      (_, index) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
    );

    const response = await putLineup(mem, ten);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('manual_lineup_limit_free');
  });

  it('serves the demo fixture without carrying or writing', async () => {
    const mem = seed();
    const before = structuredClone(mem.rows('lineup_slots'));

    const response = await getLineup(mem, DEMO_LEAGUE_ID, '', DEMO_USER);

    expect(response.statusCode).toBe(200);
    expect(response.json().league_id).toBe(DEMO_LEAGUE_ID);
    expect(mem.rows('lineup_slots')).toEqual(before);
    expect(stakesWrite.writeThroughLeagueStakes).not.toHaveBeenCalled();

    await app?.close();
    const put = await putLineup(mem, [], { user: DEMO_USER });
    expect(put.statusCode).toBe(409);
    expect(put.json().error.code).toBe('demo_account_fixed');
  });
});
