import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
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
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import stakesRoutes from './stakes.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const OTHER = '11111111-1111-4111-8111-111111111111';
const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const OTHER_GAME = '75e386ee-05e0-47cf-87ab-0a5d2af2e1d8';
const HOME = 'f2624144-a1b6-4415-bacc-217a25b2aa62';
const AWAY = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
const ROSTERED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Row = Record<string, unknown>;

class Mem {
  games: Row[] = [];
  teams: Row[] = [];
  stakes: Row[] = [];
  private next = 1;

  from(table: 'games' | 'teams' | 'stakes'): Query {
    const rows = table === 'games' ? this.games : table === 'teams' ? this.teams : this.stakes;
    return new Query(rows, () => {
      const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
      this.next += 1;
      return id;
    });
  }
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private mode: 'select' | 'insert' | 'delete' = 'select';
  private filters: ((row: Row) => boolean)[] = [];
  private payload: Row | null = null;
  private one: 'many' | 'maybe' | 'single' = 'many';

  constructor(
    private readonly rows: Row[],
    private readonly nextId: () => string,
  ) {}

  select(): this {
    return this;
  }

  insert(row: Row): this {
    this.mode = 'insert';
    this.payload = row;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: null }> {
    this.one = 'maybe';
    return this.execute();
  }

  single(): Promise<{ data: unknown; error: null }> {
    this.one = 'single';
    return this.execute();
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<{ data: unknown; error: null }> {
    if (this.mode === 'insert' && this.payload) {
      const created: Row = {
        id: this.nextId(),
        created_at: '2026-10-09T16:00:00.000Z',
        ...this.payload,
      };
      this.rows.push(created);
      return Promise.resolve({ data: created, error: null });
    }
    const matched = this.rows.filter((row) => this.filters.every((keep) => keep(row)));
    if (this.mode === 'delete') {
      for (const row of matched) {
        const index = this.rows.indexOf(row);
        if (index >= 0) this.rows.splice(index, 1);
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (this.one === 'many') return Promise.resolve({ data: matched, error: null });
    return Promise.resolve({ data: matched[0] ?? null, error: null });
  }
}

function openGame(overrides: Partial<Row> = {}): Row {
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

async function signToken(sub: string): Promise<string> {
  return await new SignJWT({ sub, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function buildApp(mem: Mem) {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: 5, seasonType: 'regular', seasonStartDate: '2026-09-09' },
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
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(stakesRoutes);
  return fastify;
}

describe('manual stakes', () => {
  let mem: Mem;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  async function setup(games: Row[] = [openGame()]) {
    mem = new Mem();
    mem.games = games;
    mem.teams = [
      { id: HOME, abbreviation: 'CHI', name: 'Bears' },
      { id: AWAY, abbreviation: 'PHI', name: 'Eagles' },
    ];
    app = await buildApp(mem);
    token = await signToken(USER);
  }

  async function post(body: Record<string, unknown>, bearer = token) {
    return await app.inject({
      method: 'POST',
      url: '/stakes',
      headers: { authorization: `Bearer ${bearer}` },
      payload: body,
    });
  }

  it('rejects a missing, out-of-season, non-regular, or final game', async () => {
    await setup([
      openGame({ id: OTHER_GAME, season_year: 2025 }),
      openGame({ season_type: 'pre' }),
    ]);
    mem.games.push(openGame({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'final' }));

    const missing = await post({
      type: 'MONEYLINE',
      gameId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      teamId: AWAY,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('stake_game_invalid');

    const old = await post({ type: 'MONEYLINE', gameId: OTHER_GAME, teamId: AWAY });
    expect(old.json().error.code).toBe('stake_game_invalid');

    const pre = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(pre.json().error.code).toBe('stake_game_invalid');

    const finalGame = await post({
      type: 'MONEYLINE',
      gameId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      teamId: AWAY,
    });
    expect(finalGame.json().error.code).toBe('stake_game_invalid');
  });

  it('rejects a team that is missing or not in the game', async () => {
    await setup();
    const missing = await post({ type: 'SPREAD', gameId: GAME, line: -3.5 });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('stake_team_invalid');

    const other = await post({
      type: 'SURVIVOR',
      gameId: GAME,
      teamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    expect(other.json().error.code).toBe('stake_team_invalid');
  });

  it('rejects lines outside the half-point windows, and any line on moneyline or survivor', async () => {
    await setup();
    const cases = [
      { type: 'SPREAD', gameId: GAME, teamId: AWAY, line: 0.25 },
      { type: 'SPREAD', gameId: GAME, teamId: AWAY, line: 50.5 },
      { type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -50.5 },
      { type: 'TOTAL_OVER', gameId: GAME, line: 9.5 },
      { type: 'TOTAL_UNDER', gameId: GAME, line: 100.5 },
      { type: 'TOTAL_OVER', gameId: GAME, line: 47.25 },
      { type: 'SPREAD', gameId: GAME, teamId: AWAY },
      { type: 'MONEYLINE', gameId: GAME, teamId: AWAY, line: -3 },
      { type: 'SURVIVOR', gameId: GAME, teamId: AWAY, line: 0 },
    ];
    for (const body of cases) {
      const response = await post(body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('stake_line_invalid');
    }
  });

  it('builds a TEAM or GAME stake for each manual type', async () => {
    await setup();
    const spread = await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 });
    expect(spread.statusCode).toBe(200);
    expect(spread.json().stake).toMatchObject({
      source: 'MANUAL',
      weight: 1,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'TEAM', teamId: AWAY },
      condition: { type: 'SPREAD', line: -3.5 },
    });

    const over = await post({ type: 'TOTAL_OVER', gameId: GAME, line: 47.5 });
    expect(over.json().stake).toMatchObject({
      subject: { type: 'GAME', gameId: GAME },
      condition: { type: 'TOTAL_OVER', line: 47.5 },
      source: 'MANUAL',
      weight: 1,
    });

    const under = await post({ type: 'TOTAL_UNDER', gameId: GAME, line: 10 });
    expect(under.json().stake.condition).toEqual({ type: 'TOTAL_UNDER', line: 10 });
    expect(under.json().stake.subject).toEqual({ type: 'GAME', gameId: GAME });

    const moneyline = await post({ type: 'MONEYLINE', gameId: GAME, teamId: HOME });
    expect(moneyline.json().stake).toMatchObject({
      subject: { type: 'TEAM', teamId: HOME },
      condition: { type: 'MONEYLINE', side: 'TEAM' },
    });

    const survivor = await post({ type: 'SURVIVOR', gameId: GAME, teamId: AWAY });
    expect(survivor.json().stake).toMatchObject({
      subject: { type: 'TEAM', teamId: AWAY },
      condition: { type: 'SURVIVOR' },
    });
    expect(survivor.json().stake.condition.line).toBeUndefined();
  });

  it('returns 409 when a survivor pick already exists for the week', async () => {
    await setup();
    expect((await post({ type: 'SURVIVOR', gameId: GAME, teamId: AWAY })).statusCode).toBe(200);
    const again = await post({ type: 'SURVIVOR', gameId: GAME, teamId: HOME });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('survivor_pick_exists');
  });

  it('returns 409 when the same stake already exists', async () => {
    await setup();
    const body = { type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 };
    expect((await post(body)).statusCode).toBe(200);
    const again = await post(body);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('stake_duplicate');

    const otherLine = await post({ ...body, line: -7 });
    expect(otherLine.statusCode).toBe(200);
  });

  it('lists manual stakes with the game and hides fantasy rows', async () => {
    await setup();
    await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 });
    mem.stakes.push({
      id: ROSTERED_ID,
      user_id: USER,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'PLAYER', playerId: 'p1', teamId: AWAY },
      condition: { type: 'ROSTERED' },
      source: 'SLEEPER_ROSTER',
      weight: 1,
      created_at: '2026-10-09T15:00:00.000Z',
    });
    mem.stakes.push({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      user_id: USER,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'PLAYER', playerId: 'p2', teamId: HOME },
      condition: { type: 'OPPONENT_ROSTERED' },
      source: 'SLEEPER_OPPONENT',
      weight: 0.5,
      created_at: '2026-10-09T15:01:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/stakes',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      week: number;
      stakes: {
        condition: { type: string };
        game: { away_team: string; scheduled_start: string; status: string };
      }[];
    };
    expect(body.week).toBe(5);
    expect(body.stakes.map((stake) => stake.condition.type)).toEqual(['SPREAD']);
    expect(body.stakes[0]?.game).toMatchObject({
      away_team: 'PHI',
      home_team: 'CHI',
      status: 'scheduled',
      scheduled_start: '2026-10-11T17:00:00.000Z',
    });
  });

  it("returns 404 when deleting another user's stake and 403 for a rostered row", async () => {
    await setup();
    mem.stakes.push({
      id: FOREIGN_ID,
      user_id: OTHER,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'TEAM', teamId: AWAY },
      condition: { type: 'MONEYLINE', side: 'TEAM' },
      source: 'MANUAL',
      weight: 1,
      created_at: '2026-10-09T15:00:00.000Z',
    });
    mem.stakes.push({
      id: ROSTERED_ID,
      user_id: USER,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'PLAYER', playerId: 'p1', teamId: AWAY },
      condition: { type: 'ROSTERED' },
      source: 'SLEEPER_ROSTER',
      weight: 1,
      created_at: '2026-10-09T15:00:00.000Z',
    });

    const foreign = await app.inject({
      method: 'DELETE',
      url: `/stakes/${FOREIGN_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(foreign.statusCode).toBe(404);

    const rostered = await app.inject({
      method: 'DELETE',
      url: `/stakes/${ROSTERED_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rostered.statusCode).toBe(403);
    expect(rostered.json().error.code).toBe('stake_managed_by_sync');
    expect(mem.stakes.map((row) => row['id'])).toEqual([FOREIGN_ID, ROSTERED_ID]);
  });
});
