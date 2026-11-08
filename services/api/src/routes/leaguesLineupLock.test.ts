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
import { ApiError, apiErrorHandler } from '../lib/errors.js';
import { assertStartedPlayersKept } from '../lib/lineupKickoffLock.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import leaguesRoutes from './leagues.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const LEAGUE = '11111111-1111-4111-8111-111111111111';
const CHI = 'f2624144-a1b6-4415-bacc-217a25b2aa62';
const PHI = '4e380990-e5ea-4b5e-bed5-fa1b919830e3';
const DAL = '0c7d8f3e-6a3b-4a59-9d55-2f6c1e0b7a11';
const NYG = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const BYE = '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910';

// CHI and PHI play at 17:00Z. DAL and NYG play at 00:20Z the next day. BYE has no game.
const BEARS_RB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const EAGLES_WR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const COWBOYS_QB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const BYE_TE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const FREE_AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const GIANTS_K = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';

const BEFORE_ANY = new Date('2026-10-11T16:00:00.000Z');
const AFTER_EARLY = new Date('2026-10-11T17:30:00.000Z');

type Row = Record<string, unknown>;

class Mem {
  readonly tables: Record<string, Row[]> = {};

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  from(table: string): Query {
    return new Query(this.rows(table));
  }
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private mode: 'select' | 'delete' = 'select';
  private filters: ((row: Row) => boolean)[] = [];

  constructor(private readonly rows: Row[]) {}

  select(): this {
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
    return this.execute().then(({ data }) => ({
      data: (data as Row[])[0] ?? null,
      error: null,
    }));
  }

  single(): Promise<{ data: unknown; error: null }> {
    return this.maybeSingle();
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
    const matched = this.rows.filter((row) => this.filters.every((keep) => keep(row)));
    if (this.mode === 'delete') {
      for (const row of matched) this.rows.splice(this.rows.indexOf(row), 1);
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: matched, error: null });
  }
}

function game(home: string, away: string, start: string, status = 'scheduled'): Row {
  return {
    home_team_id: home,
    away_team_id: away,
    season_year: 2026,
    week: 5,
    season_type: 'regular',
    status,
    scheduled_start: start,
  };
}

function slot(playerId: string, slotType = 'starter', position = 'RB1'): Row {
  return {
    league_id: LEAGUE,
    week: 5,
    player_id: playerId,
    slot_type: slotType,
    position_in_lineup: position,
    is_star: false,
  };
}

function seed(tier: 'free' | 'pro' = 'free'): Mem {
  const mem = new Mem();
  mem.rows('users').push({ id: USER, is_demo: false, subscription_tier: tier });
  mem.rows('leagues').push({
    id: LEAGUE,
    user_id: USER,
    platform: 'manual',
    name: 'Manual',
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
  });
  mem
    .rows('players')
    .push(
      { id: BEARS_RB, team_id: CHI },
      { id: EAGLES_WR, team_id: PHI },
      { id: COWBOYS_QB, team_id: DAL },
      { id: BYE_TE, team_id: BYE },
      { id: FREE_AGENT, team_id: null },
      { id: GIANTS_K, team_id: NYG },
    );
  mem.rows('games').push(
    game(CHI, PHI, '2026-10-11T17:00:00.000Z'),
    game(DAL, NYG, '2026-10-12T00:20:00.000Z'),
    // Last season's week 5 between the same teams must not lock anything.
    { ...game(DAL, NYG, '2025-10-05T17:00:00.000Z', 'final'), season_year: 2025 },
  );
  mem
    .rows('lineup_slots')
    .push(
      slot(BEARS_RB),
      slot(EAGLES_WR, 'starter', 'WR1'),
      slot(COWBOYS_QB, 'starter', 'QB'),
      slot(BYE_TE, 'bench', 'BN'),
      slot(FREE_AGENT, 'bench', 'BN'),
    );
  return mem;
}

async function lock(mem: Mem, nextPlayerIds: string[], now: Date) {
  await assertStartedPlayersKept(mem as unknown as SupabaseServiceClient, {
    leagueId: LEAGUE,
    season: 2026,
    week: 5,
    nextPlayerIds,
    now,
  });
}

async function lockError(mem: Mem, nextPlayerIds: string[], now: Date): Promise<ApiError> {
  try {
    await lock(mem, nextPlayerIds, now);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the lineup lock to reject');
}

const EVERYONE = [BEARS_RB, EAGLES_WR, COWBOYS_QB, BYE_TE, FREE_AGENT];

describe('assertStartedPlayersKept', () => {
  it('allows any swap before kickoff', async () => {
    await expect(lock(seed(), [GIANTS_K], BEFORE_ANY)).resolves.toBeUndefined();
  });

  it('rejects removing a player whose game has kicked off, naming every locked player', async () => {
    const error = await lockError(seed(), [COWBOYS_QB, BYE_TE, FREE_AGENT, GIANTS_K], AFTER_EARLY);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('lineup_player_locked');
    expect(error.message).toBe('These players are locked because their games have started.');
    expect(error.details).toEqual({ player_ids: [BEARS_RB, EAGLES_WR] });
  });

  it('allows removing players whose games have not started, or who are on a bye', async () => {
    await expect(
      lock(seed(), [BEARS_RB, EAGLES_WR, GIANTS_K], AFTER_EARLY),
    ).resolves.toBeUndefined();
  });

  it('allows keeping started players while adding others', async () => {
    await expect(lock(seed(), [...EVERYONE, GIANTS_K], AFTER_EARLY)).resolves.toBeUndefined();
  });

  it('locks on an in-progress status even before the scheduled start', async () => {
    const mem = seed();
    const late = mem.rows('games')[1];
    if (late === undefined) throw new Error('missing game');
    late['status'] = 'in_progress';
    const error = await lockError(mem, [BEARS_RB, EAGLES_WR], BEFORE_ANY);
    expect(error.details).toEqual({ player_ids: [COWBOYS_QB] });
  });

  it('ignores other weeks of the lineup', async () => {
    const mem = seed();
    mem.rows('lineup_slots').push({ ...slot(GIANTS_K), week: 4 });
    await expect(lock(mem, EVERYONE, AFTER_EARLY)).resolves.toBeUndefined();
  });
});

async function signToken(sub: string): Promise<string> {
  return await new SignJWT({ sub, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('PUT /leagues/:id/lineup kickoff lock', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function buildApp(mem: Mem, now: Date) {
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
      lineupCache: new InMemoryLineupCache(),
      gameStateStore: new InMemoryGameStateStore(),
      realtimeSubscriber: new InMemoryRealtimeBus(),
    });
    await fastify.register(leaguesRoutes, { now: () => now });
    return fastify;
  }

  async function putLineup(mem: Mem, now: Date, playerIds: string[]) {
    app = await buildApp(mem, now);
    return await app.inject({
      method: 'PUT',
      url: `/leagues/${LEAGUE}/lineup`,
      headers: { authorization: `Bearer ${await signToken(USER)}` },
      payload: {
        week: 5,
        slots: playerIds.map((id, index) => ({
          player_id: id,
          slot_type: 'starter',
          position_in_lineup: `S${index + 1}`,
        })),
      },
    });
  }

  it('returns 409 and leaves the lineup untouched when a started player is swapped out', async () => {
    const mem = seed();
    const before = structuredClone(mem.rows('lineup_slots'));
    const response = await putLineup(mem, AFTER_EARLY, [
      EAGLES_WR,
      COWBOYS_QB,
      BYE_TE,
      FREE_AGENT,
      GIANTS_K,
    ]);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'lineup_player_locked',
        message: 'This player is locked because the game has started.',
        details: { player_ids: [BEARS_RB] },
      },
    });
    expect(mem.rows('lineup_slots')).toEqual(before);
  });

  it('applies the lock to Pro users too', async () => {
    const mem = seed('pro');
    const response = await putLineup(mem, AFTER_EARLY, [GIANTS_K]);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('lineup_player_locked');
  });
});
