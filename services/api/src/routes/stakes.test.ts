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
  users: Row[] = [];
  spent: Row[] = [];
  private next = 1;

  from(table: 'games' | 'teams' | 'stakes' | 'users' | 'stake_spent_slots'): Query {
    const rows =
      table === 'games'
        ? this.games
        : table === 'teams'
          ? this.teams
          : table === 'users'
            ? this.users
            : table === 'stake_spent_slots'
              ? this.spent
              : this.stakes;
    return new Query(rows, () => {
      const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
      this.next += 1;
      return id;
    });
  }
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private mode: 'select' | 'insert' | 'upsert' | 'delete' = 'select';
  private conflictKey = '';
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

  upsert(row: Row, options: { onConflict: string; ignoreDuplicates?: boolean }): this {
    this.mode = 'upsert';
    this.payload = row;
    this.conflictKey = options.onConflict;
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
    if (this.mode === 'upsert' && this.payload) {
      const key = this.payload[this.conflictKey];
      if (!this.rows.some((row) => row[this.conflictKey] === key)) {
        this.rows.push({ ...this.payload });
      }
      return Promise.resolve({ data: null, error: null });
    }
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

/** Before the fixture game's 2026-10-11 17:00Z kickoff. */
const BEFORE_KICKOFF = '2026-10-09T16:00:00.000Z';
const AFTER_KICKOFF = '2026-10-11T17:30:00.000Z';

async function buildApp(mem: Mem, clock: { now: Date }) {
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
  await fastify.register(stakesRoutes, { now: () => clock.now });
  return fastify;
}

describe('manual stakes', () => {
  let mem: Mem;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let clock: { now: Date };

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
    mem.users = [{ id: USER, subscription_tier: 'free' }];
    clock = { now: new Date(BEFORE_KICKOFF) };
    app = await buildApp(mem, clock);
    token = await signToken(USER);
  }

  function asPro() {
    const user = mem.users[0];
    if (user === undefined) throw new Error('missing test user');
    user['subscription_tier'] = 'pro';
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
    asPro();
    const spread = await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 });
    expect(spread.statusCode).toBe(201);
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
    expect((await post({ type: 'SURVIVOR', gameId: GAME, teamId: AWAY })).statusCode).toBe(201);
    const again = await post({ type: 'SURVIVOR', gameId: GAME, teamId: HOME });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('survivor_pick_exists');
  });

  it('returns 409 when the same stake already exists', async () => {
    await setup();
    const body = { type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 };
    expect((await post(body)).statusCode).toBe(201);
    const again = await post(body);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('stake_duplicate');

    const otherLine = await post({ ...body, line: -7 });
    expect(otherLine.statusCode).toBe(201);
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
    expect(await app.lineupCache.getUsersWithBet(GAME)).toEqual([]);
  });

  it('adds the game on create and removes it only when the last bet is gone', async () => {
    await setup([openGame(), openGame({ id: OTHER_GAME })]);
    const spread = await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 });
    expect(spread.statusCode).toBe(201);
    expect(await app.lineupCache.getUsersWithBet(GAME)).toEqual([USER]);

    const over = await post({ type: 'TOTAL_OVER', gameId: GAME, line: 47.5 });
    expect(over.statusCode).toBe(201);
    const overId = (over.json() as { stake: { id: string } }).stake.id;
    expect(await app.lineupCache.getUsersWithBet(GAME)).toEqual([USER]);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/stakes/${overId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
    expect(await app.lineupCache.getUsersWithBet(GAME)).toEqual([USER]);

    const spreadId = (spread.json() as { stake: { id: string } }).stake.id;
    const last = await app.inject({
      method: 'DELETE',
      url: `/stakes/${spreadId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(last.statusCode).toBe(204);
    expect(await app.lineupCache.getUsersWithBet(GAME)).toEqual([]);
  });

  async function fillFreeCap() {
    expect(
      (await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 })).statusCode,
    ).toBe(201);
    expect((await post({ type: 'TOTAL_OVER', gameId: GAME, line: 47.5 })).statusCode).toBe(201);
    const third = await post({ type: 'MONEYLINE', gameId: GAME, teamId: HOME });
    expect(third.statusCode).toBe(201);
    return third;
  }

  function seedSurvivor(index: number, teamId: string) {
    mem.stakes.push({
      id: `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      user_id: USER,
      season: 2026,
      week: 5,
      game_id: GAME,
      subject: { type: 'TEAM', teamId },
      condition: { type: 'SURVIVOR' },
      source: 'MANUAL',
      weight: 1,
      created_at: '2026-10-09T15:00:00.000Z',
    });
  }

  it('returns 403 when a free user already has 3 bets that week, and 201 for the third', async () => {
    await setup();
    await fillFreeCap();
    const fourth = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json()).toEqual({
      error: {
        code: 'stake_limit_free',
        message: 'Free accounts can track up to 3 bets a week. Upgrade to Pro for unlimited bets.',
        details: { limit: 3 },
      },
    });
  });

  it('lets a free user add a survivor pick when 3 bets already fill the cap', async () => {
    await setup();
    await fillFreeCap();
    const survivor = await post({ type: 'SURVIVOR', gameId: GAME, teamId: AWAY });
    expect(survivor.statusCode).toBe(201);
  });

  it('does not let existing survivor picks use free-bet slots', async () => {
    await setup();
    expect(
      (await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: -3.5 })).statusCode,
    ).toBe(201);
    expect((await post({ type: 'TOTAL_OVER', gameId: GAME, line: 47.5 })).statusCode).toBe(201);
    seedSurvivor(1, HOME);
    seedSurvivor(2, AWAY);
    const third = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(third.statusCode).toBe(201);
    const fourth = await post({ type: 'TOTAL_UNDER', gameId: GAME, line: 44.5 });
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json().error.code).toBe('stake_limit_free');
  });

  it('frees the slot when a counted stake is deleted', async () => {
    await setup();
    const counted = await fillFreeCap();
    const id = (counted.json() as { stake: { id: string } }).stake.id;
    const removed = await app.inject({
      method: 'DELETE',
      url: `/stakes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(204);
    const again = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(again.statusCode).toBe(201);
  });

  async function remove(id: string) {
    return await app.inject({
      method: 'DELETE',
      url: `/stakes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function list() {
    return await app.inject({
      method: 'GET',
      url: '/stakes?week=5',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  describe('after kickoff', () => {
    it('keeps the slot spent when a counted pick is removed after its game starts', async () => {
      await setup();
      const counted = await fillFreeCap();
      const id = (counted.json() as { stake: { id: string } }).stake.id;
      clock.now = new Date(AFTER_KICKOFF);

      expect((await remove(id)).statusCode).toBe(204);
      expect(mem.stakes.some((stake) => stake['id'] === id)).toBe(false);
      expect(mem.spent).toEqual([
        { stake_id: id, user_id: USER, season: 2026, week: 5, game_id: GAME },
      ]);

      const again = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
      expect(again.statusCode).toBe(403);
      expect(again.json().error.code).toBe('stake_limit_free');
      expect((await list()).json().free_slots_spent).toBe(1);
    });

    it('treats an in-progress game as started even before its scheduled time', async () => {
      await setup();
      const counted = await fillFreeCap();
      const id = (counted.json() as { stake: { id: string } }).stake.id;
      const game = mem.games[0];
      if (game === undefined) throw new Error('missing test game');
      game['status'] = 'in_progress';

      expect((await remove(id)).statusCode).toBe(204);
      expect(mem.spent).toHaveLength(1);
    });

    it('refunds a slot removed before kickoff but not one removed after', async () => {
      await setup([
        openGame(),
        openGame({ id: OTHER_GAME, scheduled_start: '2026-10-12T00:15:00.000Z' }),
      ]);
      const early = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
      const late = await post({ type: 'MONEYLINE', gameId: OTHER_GAME, teamId: HOME });
      const earlyId = (early.json() as { stake: { id: string } }).stake.id;
      const lateId = (late.json() as { stake: { id: string } }).stake.id;

      // The late game has not started: removing it refunds the slot.
      clock.now = new Date(AFTER_KICKOFF);
      expect((await remove(lateId)).statusCode).toBe(204);
      // The early game has started: removing it keeps the slot spent.
      expect((await remove(earlyId)).statusCode).toBe(204);
      expect(mem.spent.map((row) => row['stake_id'])).toEqual([earlyId]);

      // One slot spent, two free: a live bet on the started game still counts and is allowed.
      expect((await post({ type: 'TOTAL_OVER', gameId: GAME, line: 47.5 })).statusCode).toBe(201);
      expect((await post({ type: 'TOTAL_UNDER', gameId: OTHER_GAME, line: 44.5 })).statusCode).toBe(
        201,
      );
      const fourth = await post({ type: 'SPREAD', gameId: OTHER_GAME, teamId: AWAY, line: 2.5 });
      expect(fourth.statusCode).toBe(403);
      expect(fourth.json().error.code).toBe('stake_limit_free');
    });

    it('does not double count a spent row whose pick still exists', async () => {
      await setup();
      const counted = await fillFreeCap();
      const id = (counted.json() as { stake: { id: string } }).stake.id;
      // A delete that failed after the spent row was written leaves both.
      mem.spent.push({ stake_id: id, user_id: USER, season: 2026, week: 5, game_id: GAME });
      expect((await list()).json().free_slots_spent).toBe(0);

      clock.now = new Date(AFTER_KICKOFF);
      expect((await remove(id)).statusCode).toBe(204);
      expect(mem.spent).toHaveLength(1);
      expect((await list()).json().free_slots_spent).toBe(1);
    });

    it('never spends a slot for a survivor pick removed after kickoff', async () => {
      await setup();
      const survivor = await post({ type: 'SURVIVOR', gameId: GAME, teamId: AWAY });
      const id = (survivor.json() as { stake: { id: string } }).stake.id;
      clock.now = new Date(AFTER_KICKOFF);

      expect((await remove(id)).statusCode).toBe(204);
      expect(mem.spent).toEqual([]);
      await fillFreeCap();
    });

    it('records the spent slot for a pro user but never caps them', async () => {
      await setup();
      asPro();
      const counted = await fillFreeCap();
      const id = (counted.json() as { stake: { id: string } }).stake.id;
      clock.now = new Date(AFTER_KICKOFF);

      expect((await remove(id)).statusCode).toBe(204);
      expect(mem.spent).toHaveLength(1);
      expect((await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY })).statusCode).toBe(201);
      expect((await post({ type: 'TOTAL_UNDER', gameId: GAME, line: 44.5 })).statusCode).toBe(201);
    });

    it("does not count another week's spent slots", async () => {
      await setup();
      mem.spent.push(
        { stake_id: OTHER, user_id: USER, season: 2026, week: 4, game_id: OTHER_GAME },
        { stake_id: FOREIGN_ID, user_id: OTHER, season: 2026, week: 5, game_id: GAME },
      );
      await fillFreeCap();
      expect((await list()).json().free_slots_spent).toBe(0);
    });
  });

  it("returns 201 for a pro user's fourth bet", async () => {
    await setup();
    asPro();
    await fillFreeCap();
    const fourth = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(fourth.statusCode).toBe(201);
  });

  it('does not count opponent or rostered rows toward the free cap', async () => {
    await setup();
    for (let index = 0; index < 20; index += 1) {
      mem.stakes.push({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        user_id: USER,
        season: 2026,
        week: 5,
        game_id: GAME,
        subject: { type: 'PLAYER', playerId: `roster-${index}` },
        condition: { type: 'ROSTERED' },
        source: 'SLEEPER_ROSTER',
        weight: 1,
        created_at: '2026-10-09T15:00:00.000Z',
      });
    }
    for (let index = 0; index < 14; index += 1) {
      mem.stakes.push({
        id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        user_id: USER,
        season: 2026,
        week: 5,
        game_id: GAME,
        subject: { type: 'PLAYER', playerId: `opp-${index}` },
        condition: { type: 'OPPONENT_ROSTERED' },
        source: 'SLEEPER_OPPONENT',
        weight: 1,
        created_at: '2026-10-09T15:00:00.000Z',
      });
    }
    await fillFreeCap();
  });

  it("does not count another week's bets", async () => {
    await setup();
    for (let index = 0; index < 4; index += 1) {
      mem.stakes.push({
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        user_id: USER,
        season: 2026,
        week: 4,
        game_id: OTHER_GAME,
        subject: { type: 'TEAM', teamId: AWAY },
        condition: { type: 'SPREAD', line: -3.5 - index },
        source: 'MANUAL',
        weight: 1,
        created_at: '2026-10-02T15:00:00.000Z',
      });
    }
    const weekFive = await post({ type: 'MONEYLINE', gameId: GAME, teamId: AWAY });
    expect(weekFive.statusCode).toBe(201);
  });

  it('reports a validation error before the cap when the fourth request has an invalid line', async () => {
    await setup();
    await fillFreeCap();
    const fourth = await post({ type: 'SPREAD', gameId: GAME, teamId: AWAY, line: 0.25 });
    expect(fourth.statusCode).toBe(400);
    expect(fourth.json().error.code).toBe('stake_line_invalid');
    expect(
      mem.stakes.filter((stake) => {
        const condition = stake['condition'] as { type?: string };
        return condition.type !== 'ROSTERED' && condition.type !== 'OPPONENT_ROSTERED';
      }),
    ).toHaveLength(3);
  });
});
