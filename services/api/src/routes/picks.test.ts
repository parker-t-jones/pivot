import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import type { GamePlayerStats, GameState } from '@pivot/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { apiErrorHandler } from '../lib/errors.js';
import { MemSupabase, type Row } from '../lib/memSupabase.test-helper.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import picksRoutes from './picks.js';
import stakesRoutes from './stakes.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const LATE_GAME = '75e386ee-05e0-47cf-87ab-0a5d2af2e1d8';
const NEXT_WEEK_GAME = '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a';
const FINAL_GAME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME = 'f2624144-a1b6-4415-bacc-217a25b2aa62';
const AWAY = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
const OTHER_TEAM = '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e';
const RB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BENCHED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STRANGER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const BEFORE_KICKOFF = '2026-10-09T16:00:00.000Z';
const AFTER_KICKOFF = '2026-10-11T17:30:00.000Z';

function game(overrides: Row = {}): Row {
  return {
    id: GAME,
    season_year: 2026,
    week: 5,
    season_type: 'regular',
    status: 'scheduled',
    home_team_id: HOME,
    away_team_id: AWAY,
    scheduled_start: '2026-10-11T17:00:00.000Z',
    ...overrides,
  };
}

function liveState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: AWAY,
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 10,
    quarter: 2,
    timeRemainingSec: 400,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

async function signToken(sub: string): Promise<string> {
  return await new SignJWT({ sub, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface Harness {
  db: MemSupabase;
  app: Awaited<ReturnType<typeof Fastify>>;
  clock: { now: Date };
  lineupCache: InMemoryLineupCache;
  gameStates: InMemoryGameStateStore;
  stats: Map<string, GamePlayerStats>;
  token: string;
}

async function setup(): Promise<Harness> {
  const db = new MemSupabase();
  db.rows('games').push(
    game(),
    game({ id: LATE_GAME, scheduled_start: '2026-10-12T00:20:00.000Z' }),
    game({ id: NEXT_WEEK_GAME, week: 6, scheduled_start: '2026-10-18T17:00:00.000Z' }),
    game({ id: FINAL_GAME, status: 'final' }),
  );
  db.rows('teams').push(
    { id: HOME, abbreviation: 'CHI', name: 'Bears' },
    { id: AWAY, abbreviation: 'PHI', name: 'Eagles' },
  );
  db.rows('players').push(
    {
      id: RB,
      team_id: AWAY,
      position: 'RB',
      espn_id: '111',
      first_name: 'Saquon',
      last_name: 'Barkley',
      active: true,
    },
    {
      id: QB,
      team_id: HOME,
      position: 'QB',
      espn_id: '222',
      first_name: 'Caleb',
      last_name: 'Williams',
      active: true,
    },
    {
      id: BENCHED,
      team_id: AWAY,
      position: 'WR',
      espn_id: null,
      first_name: 'Old',
      last_name: 'Timer',
      active: false,
    },
    {
      id: STRANGER,
      team_id: OTHER_TEAM,
      position: 'WR',
      espn_id: null,
      first_name: 'Far',
      last_name: 'Away',
      active: true,
    },
  );
  db.rows('users').push({ id: USER, subscription_tier: 'free', is_demo: false });

  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: 5, seasonType: 'regular', seasonStartDate: '2026-09-09' },
    600,
  );
  const gameStates = new InMemoryGameStateStore();
  const stats = new Map<string, GamePlayerStats>();
  const clock = { now: new Date(BEFORE_KICKOFF) };
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(apiErrorHandler);
  await app.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await app.register(servicesPlugin, {
    supabase: db as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore: gameStates,
    realtimeSubscriber: new InMemoryRealtimeBus(),
    readGamePlayerStats: async (gameId) => stats.get(gameId) ?? null,
  });
  await app.register(picksRoutes, { now: () => clock.now });
  await app.register(stakesRoutes, { now: () => clock.now });
  return { db, app, clock, lineupCache, gameStates, stats, token: await signToken(USER) };
}

const rushOver = (line = 89.5, gameId = GAME) => ({
  gameId,
  playerId: RB,
  condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line },
});
const teamTotal = (line = 24.5, gameId = GAME) => ({
  gameId,
  teamId: AWAY,
  condition: { type: 'TEAM_TOTAL_OVER', line },
});
const qbYards = (line = 249.5) => ({
  gameId: GAME,
  playerId: QB,
  condition: { type: 'STAT_OVER', stat: 'PASS_YDS', line },
});

describe('picks routes', () => {
  let h: Harness;

  afterEach(async () => {
    await h.app.close();
  });

  async function post(payload: unknown) {
    return h.app.inject({
      method: 'POST',
      url: '/picks',
      headers: { authorization: `Bearer ${h.token}` },
      payload: payload as Record<string, unknown>,
    });
  }

  async function get(url: string) {
    return h.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${h.token}` } });
  }

  async function del(url: string) {
    return h.app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${h.token}` } });
  }

  describe('POST /picks: single picks', () => {
    it('stores a player prop on the player and team, and indexes the game as a bet', async () => {
      h = await setup();
      const res = await post({ pick: rushOver() });
      expect(res.statusCode).toBe(201);
      expect(res.json().pick).toMatchObject({
        game_id: GAME,
        subject: { type: 'PLAYER', playerId: RB, teamId: AWAY },
        condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 },
        slip_id: null,
      });
      expect(await h.lineupCache.getUsersWithBet(GAME)).toEqual([USER]);
    });

    it('stores team, game, and segment props on the right subject', async () => {
      h = await setup();
      const team = await post({ pick: teamTotal() });
      expect(team.json().pick.subject).toEqual({ type: 'TEAM', teamId: AWAY });
      const fg = await post({
        pick: { gameId: GAME, condition: { type: 'FG_OVER', line: 3.5, segment: 'H1' } },
      });
      expect(fg.json().pick.subject).toEqual({ type: 'GAME', gameId: GAME });
      expect(fg.json().pick.condition).toEqual({ type: 'FG_OVER', line: 3.5, segment: 'H1' });
    });

    it('rejects a player who is not in the game, is inactive, or is missing', async () => {
      h = await setup();
      for (const playerId of [STRANGER, BENCHED, undefined]) {
        const res = await post({ pick: { ...rushOver(), playerId } });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('stake_player_invalid');
      }
    });

    it('rejects a team prop without a team in the game', async () => {
      h = await setup();
      const res = await post({ pick: { ...teamTotal(), teamId: OTHER_TEAM } });
      expect(res.json().error.code).toBe('stake_team_invalid');
    });

    it('rejects lines that are not a half point or are out of range', async () => {
      h = await setup();
      for (const line of [89.3, 0, 401]) {
        const res = await post({ pick: rushOver(line) });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('stake_line_invalid');
      }
    });

    it('rejects a final game but accepts a live one (live bet)', async () => {
      h = await setup();
      const final = await post({ pick: rushOver(89.5, FINAL_GAME) });
      expect(final.json().error.code).toBe('stake_game_invalid');
      h.db.at('games', 0)['status'] = 'in_progress';
      const live = await post({ pick: rushOver() });
      expect(live.statusCode).toBe(201);
    });

    it('rejects a duplicate single but allows the same line on another segment', async () => {
      h = await setup();
      expect((await post({ pick: teamTotal(10.5) })).statusCode).toBe(201);
      const again = await post({ pick: teamTotal(10.5) });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('stake_duplicate');
      const firstHalf = await post({
        pick: {
          ...teamTotal(10.5),
          condition: { type: 'TEAM_TOTAL_OVER', line: 10.5, segment: 'H1' },
        },
      });
      expect(firstHalf.statusCode).toBe(201);
    });

    it('refuses fantasy rows', async () => {
      h = await setup();
      const res = await post({
        pick: { gameId: GAME, playerId: RB, condition: { type: 'ROSTERED' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('caps a free account at 3 and lets Pro add more', async () => {
      h = await setup();
      for (const line of [10.5, 20.5, 30.5]) {
        expect((await post({ pick: teamTotal(line) })).statusCode).toBe(201);
      }
      const fourth = await post({ pick: rushOver() });
      expect(fourth.statusCode).toBe(403);
      expect(fourth.json().error.code).toBe('stake_limit_free');
      h.db.at('users', 0)['subscription_tier'] = 'pro';
      expect((await post({ pick: rushOver() })).statusCode).toBe(201);
    });
  });

  describe('POST /picks: parlays', () => {
    it('creates one slip with every leg, indexing each leg game', async () => {
      h = await setup();
      const res = await post({ legs: [rushOver(), qbYards(), teamTotal(20.5, LATE_GAME)] });
      expect(res.statusCode).toBe(201);
      const slip = res.json().slip;
      expect(slip.legs).toHaveLength(3);
      expect(slip.legs.every((leg: { slip_id: string }) => leg.slip_id === slip.id)).toBe(true);
      expect(h.db.rows('pick_slips')).toHaveLength(1);
      expect(await h.lineupCache.getUsersWithBet(LATE_GAME)).toEqual([USER]);
    });

    it('counts a parlay as one free slot', async () => {
      h = await setup();
      await post({ pick: teamTotal(10.5) });
      await post({ pick: teamTotal(20.5) });
      const slip = await post({ legs: [rushOver(), qbYards(), teamTotal(30.5)] });
      expect(slip.statusCode).toBe(201);
      const used = await get('/picks');
      expect(used.json().free_slots_used).toBe(3);
      const over = await post({ legs: [rushOver(100.5), qbYards(300.5)] });
      expect(over.statusCode).toBe(403);
      expect(over.json().error.code).toBe('stake_limit_free');
    });

    it('refuses a parlay when the free slots are already used', async () => {
      h = await setup();
      for (const line of [10.5, 20.5, 30.5]) await post({ pick: teamTotal(line) });
      const res = await post({ legs: [rushOver(), qbYards()] });
      expect(res.json().error.code).toBe('stake_limit_free');
      expect(h.db.rows('pick_slips')).toHaveLength(0);
    });

    it('rejects one leg, a survivor leg, mixed weeks, and a repeated leg', async () => {
      h = await setup();
      expect((await post({ legs: [rushOver()] })).statusCode).toBe(400);
      const survivor = await post({
        legs: [rushOver(), { gameId: GAME, teamId: AWAY, condition: { type: 'SURVIVOR' } }],
      });
      expect(survivor.json().error.code).toBe('slip_leg_invalid');
      const weeks = await post({ legs: [rushOver(), teamTotal(20.5, NEXT_WEEK_GAME)] });
      expect(weeks.json().error.code).toBe('slip_week_mismatch');
      const twice = await post({ legs: [rushOver(), rushOver()] });
      expect(twice.json().error.code).toBe('slip_duplicate_leg');
      expect(h.db.rows('pick_slips')).toHaveLength(0);
    });

    it('allows a leg that matches an existing single', async () => {
      h = await setup();
      await post({ pick: rushOver() });
      h.db.at('users', 0)['subscription_tier'] = 'pro';
      expect((await post({ legs: [rushOver(), qbYards()] })).statusCode).toBe(201);
    });
  });

  describe('removing picks', () => {
    it('refuses to delete a single leg through DELETE /stakes/:id', async () => {
      h = await setup();
      const slip = (await post({ legs: [rushOver(), qbYards()] })).json().slip;
      const res = await del(`/stakes/${slip.legs[0].id}`);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('pick_in_slip');
    });

    it('refunds a parlay removed before kickoff', async () => {
      h = await setup();
      const slip = (await post({ legs: [rushOver(), qbYards()] })).json().slip;
      expect((await del(`/picks/slips/${slip.id}`)).statusCode).toBe(204);
      expect(h.db.rows('stakes')).toHaveLength(0);
      expect(h.db.rows('stake_spent_slots')).toHaveLength(0);
      expect((await get('/picks')).json().free_slots_used).toBe(0);
      expect(await h.lineupCache.getUsersWithBet(GAME)).toEqual([]);
    });

    it('keeps one slot spent for a parlay removed after its first leg kicks off', async () => {
      h = await setup();
      const slip = (await post({ legs: [teamTotal(20.5, LATE_GAME), rushOver()] })).json().slip;
      h.clock.now = new Date(AFTER_KICKOFF); // GAME has kicked off, LATE_GAME has not
      expect((await del(`/picks/slips/${slip.id}`)).statusCode).toBe(204);
      expect(h.db.rows('stake_spent_slots')).toEqual([
        expect.objectContaining({ stake_id: slip.id, slot_kind: 'slip', game_id: GAME, week: 5 }),
      ]);
      expect((await get('/picks')).json().free_slots_used).toBe(1);
      expect((await get('/stakes')).json().free_slots_spent).toBe(1);
    });

    it('never counts a spent slip twice while the slip still exists', async () => {
      h = await setup();
      const slip = (await post({ legs: [rushOver(), qbYards()] })).json().slip;
      h.db.rows('stake_spent_slots').push({
        stake_id: slip.id,
        slot_kind: 'slip',
        user_id: USER,
        season: 2026,
        week: 5,
        game_id: GAME,
      });
      expect((await get('/picks')).json().free_slots_used).toBe(1);
    });

    it('404s another user’s slip', async () => {
      h = await setup();
      h.db.rows('pick_slips').push({
        id: '12121212-1212-4121-8121-121212121212',
        user_id: 'someone',
        season: 2026,
        week: 5,
      });
      expect((await del('/picks/slips/12121212-1212-4121-8121-121212121212')).statusCode).toBe(404);
    });
  });

  describe('GET /stakes for old app builds', () => {
    it('hides props, segment lines, and legs, and folds their slots into free_slots_spent', async () => {
      h = await setup();
      h.db.at('users', 0)['subscription_tier'] = 'pro';
      await post({
        pick: { gameId: GAME, teamId: AWAY, condition: { type: 'SPREAD', line: -3.5 } },
      });
      await post({ pick: rushOver() });
      await post({
        pick: { gameId: GAME, condition: { type: 'TOTAL_OVER', line: 20.5, segment: 'H1' } },
      });
      await post({ legs: [qbYards(), teamTotal(20.5)] });
      const res = (await get('/stakes')).json();
      expect(res.stakes.map((s: { condition: { type: string } }) => s.condition.type)).toEqual([
        'SPREAD',
      ]);
      expect(res.free_slots_spent).toBe(3);
    });
  });

  describe('GET /picks', () => {
    it('lists singles and slips with labels and pending progress before kickoff', async () => {
      h = await setup();
      await post({ pick: rushOver() });
      await post({ legs: [qbYards(), teamTotal(20.5)] });
      const res = (await get('/picks')).json();
      expect(res.free_limit).toBe(3);
      expect(res.picks).toHaveLength(1);
      expect(res.picks[0]).toMatchObject({
        label: 'S. Barkley over 89.5 rush yds',
        progress: { status: 'pending' },
        player: { id: RB, first_name: 'Saquon', last_name: 'Barkley', team_id: AWAY },
        game: { home_team: 'CHI', away_team: 'PHI' },
      });
      expect(res.slips).toHaveLength(1);
      expect(res.slips[0].summary).toEqual({
        status: 'pending',
        legs: 2,
        hit: 0,
        alive: 2,
        lost: 0,
        refunded: 0,
      });
      expect(res.slips[0].legs.map((l: { label: string }) => l.label)).toEqual([
        'C. Williams over 249.5 pass yds',
        'PHI team total over 20.5',
      ]);
    });

    it('shows live progress from the live game state and stats, the way Home shows scores', async () => {
      h = await setup();
      await post({ pick: rushOver() });
      await post({ legs: [qbYards(), teamTotal(9.5)] });
      h.db.at('games', 0)['status'] = 'in_progress';
      await h.gameStates.setGameState(GAME, liveState());
      h.stats.set(GAME, {
        gameId: GAME,
        fetchedAt: 1,
        final: false,
        players: {
          '111': { teamId: AWAY, displayName: 'Saquon Barkley', stats: { RUSH_YDS: 78 } },
          '222': { teamId: HOME, displayName: 'Caleb Williams', stats: { PASS_YDS: 120 } },
        },
        linescores: { home: [7, 0], away: [10, 0] },
        scoringPlays: [],
      });
      const res = (await get('/picks')).json();
      expect(res.picks[0].progress).toEqual({
        status: 'live',
        current: 78,
        line: 89.5,
        needed: 12,
      });
      expect(res.slips[0].summary).toEqual({
        status: 'live',
        legs: 2,
        hit: 1,
        alive: 1,
        lost: 0,
        refunded: 0,
      });
    });

    it('reports a stored result instead of recomputing it', async () => {
      h = await setup();
      const pick = (await post({ pick: rushOver() })).json().pick;
      const row = h.db.byId('stakes', pick.id);
      row['result'] = 'won';
      row['result_value'] = 194;
      expect((await get('/picks')).json().picks[0].progress).toEqual({
        status: 'won',
        current: 194,
      });
    });
  });

  describe('demo account', () => {
    it('refuses writes and serves the fixture picks', async () => {
      h = await setup();
      h.db.at('users', 0)['is_demo'] = true;
      const write = await post({ pick: rushOver() });
      expect(write.json().error.code).toBe('demo_account_fixed');
      const del1 = await del('/picks/slips/12121212-1212-4121-8121-121212121212');
      expect(del1.json().error.code).toBe('demo_account_fixed');
      const res = (await get('/picks')).json();
      expect(res.slips).toEqual([]);
      expect(res.picks.length).toBeGreaterThan(0);
    });
  });
});
