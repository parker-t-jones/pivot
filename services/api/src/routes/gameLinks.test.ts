import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryLineupCache } from '../cache/in-memory.js';
import { apiErrorHandler } from '../lib/errors.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import gameLinksRoutes from './gameLinks.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const OTHER = '11111111-1111-4111-8111-111111111111';
const GAME = 'e67747a6-c528-4508-b08d-e63c6f589f2e';
const UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const URL_ONE = 'https://www.primevideo.com/watch/one';
const URL_TWO = 'https://www.primevideo.com/watch/two';

type Row = Record<string, unknown>;

class Mem {
  games: Row[] = [];
  links: Row[] = [];

  from(table: 'games' | 'user_game_links'): Query {
    return new Query(table === 'games' ? this.games : this.links);
  }
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private mode: 'select' | 'upsert' | 'delete' = 'select';
  private filters: ((row: Row) => boolean)[] = [];
  private payload: Row | null = null;
  private one: 'many' | 'maybe' | 'single' = 'many';

  constructor(private readonly rows: Row[]) {}

  select(): this {
    return this;
  }

  upsert(row: Row): this {
    this.mode = 'upsert';
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
    if (this.mode === 'upsert' && this.payload) {
      const match = this.rows.find(
        (row) =>
          row['user_id'] === this.payload?.['user_id'] &&
          row['game_id'] === this.payload?.['game_id'],
      );
      if (match) {
        match['url'] = this.payload['url'];
        match['updated_at'] = this.payload['updated_at'];
        return Promise.resolve({ data: { ...match }, error: null });
      }
      const created: Row = {
        created_at: '2026-10-15T21:00:00.000Z',
        ...this.payload,
      };
      this.rows.push(created);
      return Promise.resolve({ data: { ...created }, error: null });
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

function weekGame(overrides: Partial<Row> = {}): Row {
  return {
    id: GAME,
    season_year: 2026,
    week: 6,
    season_type: 'regular',
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
    { season: '2026', week: 6, seasonType: 'regular', seasonStartDate: '2026-09-10' },
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
  await fastify.register(gameLinksRoutes);
  return fastify;
}

describe('game links', () => {
  let mem: Mem;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  async function setup() {
    mem = new Mem();
    mem.games = [weekGame()];
    app = await buildApp(mem);
    token = await signToken(USER);
  }

  function auth(bearer = token) {
    return { authorization: `Bearer ${bearer}` };
  }

  async function put(url: string, gameId = GAME, bearer = token) {
    return await app.inject({
      method: 'PUT',
      url: `/game-links/${gameId}`,
      headers: auth(bearer),
      payload: { url },
    });
  }

  async function get(week?: number, bearer = token) {
    return await app.inject({
      method: 'GET',
      url: week === undefined ? '/game-links' : `/game-links?week=${week}`,
      headers: auth(bearer),
    });
  }

  async function del(gameId = GAME, bearer = token) {
    return await app.inject({
      method: 'DELETE',
      url: `/game-links/${gameId}`,
      headers: auth(bearer),
    });
  }

  it('rejects a request with no auth', async () => {
    await setup();
    const response = await app.inject({ method: 'GET', url: '/game-links' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('returns a saved link on GET', async () => {
    await setup();
    const saved = await put(URL_ONE);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      game_id: GAME,
      url: URL_ONE,
      host: 'www.primevideo.com',
    });

    const listed = await get();
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      week: 6,
      links: [saved.json()],
    });
  });

  it('overwrites the url and bumps updated_at', async () => {
    await setup();
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);

    const first = await put(URL_ONE);
    vi.setSystemTime(start + 1000);
    const second = await put(URL_TWO);

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      game_id: GAME,
      url: URL_TWO,
      host: 'www.primevideo.com',
    });
    expect(second.json().updated_at > first.json().updated_at).toBe(true);
    expect(mem.links).toHaveLength(1);

    const listed = await get();
    expect(listed.json().links).toEqual([second.json()]);
  });

  it('deletes the link and stays empty on a second delete', async () => {
    await setup();
    await put(URL_ONE);

    const removed = await del();
    expect(removed.statusCode).toBe(204);
    expect((await get()).json()).toEqual({ week: 6, links: [] });

    const again = await del();
    expect(again.statusCode).toBe(204);
    expect((await get()).json()).toEqual({ week: 6, links: [] });
  });

  it('returns 404 for an unknown game', async () => {
    await setup();
    const response = await put(URL_ONE, UNKNOWN);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('game_not_found');
    expect(mem.links).toHaveLength(0);
  });

  it('does not show another user the saved link', async () => {
    await setup();
    await put(URL_ONE);
    const other = await signToken(OTHER);

    const hidden = await get(undefined, other);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toEqual({ week: 6, links: [] });

    const removed = await del(GAME, other);
    expect(removed.statusCode).toBe(204);
    const stillThere = await get();
    expect(stillThere.json().links).toHaveLength(1);
    expect(stillThere.json().links[0].url).toBe(URL_ONE);
  });

  it('omits the link when the requested week is different', async () => {
    await setup();
    await put(URL_ONE);
    const otherWeek = await get(5);
    expect(otherWeek.statusCode).toBe(200);
    expect(otherWeek.json()).toEqual({ week: 5, links: [] });
    expect((await get()).json().links).toHaveLength(1);
  });
});
