import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import type { GameState, UserLineupCache } from '@pivot/shared';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_WATCH_MS } from '../lib/primaryWatch.js';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { ApiError, toErrorBody } from '../lib/errors.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import sessionRoutes from './session.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const WEEK = 5;

async function signToken(payload: Record<string, unknown>, expiresIn = '1h'): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface SessionRow {
  user_id: string;
  primary_game_id: string | null;
  primary_source: string | null;
  primary_priority_score: number | null;
  thumbnail_game_ids: string[];
  device_info: unknown;
  started_at: string;
  last_updated_at: string;
}

/** Small stateful stand-in for the `viewing_sessions`/`games` tables — faithful enough to exercise
 *  upsert-preserves-unspecified-columns and update-overwrites-provided-columns semantics, which is
 *  exactly the behavior this route's merge logic (start vs. set-primary vs. clear-primary) depends on. */
class FakeSupabase {
  private readonly sessions = new Map<string, SessionRow>();
  private readonly games = new Map<string, { id: string; status: string }>();
  /** The next `games` read waits until `release` so a Switch can land before a lazy clear. */
  private statusHold: { entered: () => void; ready: Promise<void> } | null = null;

  constructor(gameIds: string[] = []) {
    for (const id of gameIds) this.games.set(id, { id, status: 'scheduled' });
  }

  armStatusHold(): { entered: Promise<void>; release: () => void } {
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.statusHold = { entered, ready };
    return { entered: enteredPromise, release };
  }

  setGameStatus(id: string, status: string): void {
    const game = this.games.get(id);
    if (!game) throw new Error(`unknown game ${id}`);
    game.status = status;
  }

  sessionRow(userId: string): SessionRow | undefined {
    return this.sessions.get(userId);
  }

  from(table: string) {
    if (table === 'games') {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => {
              const hold = this.statusHold;
              if (hold) {
                this.statusHold = null;
                hold.entered();
                await hold.ready;
              }
              return { data: this.games.get(id) ?? null, error: null };
            },
          }),
        }),
      };
    }
    if (table === 'viewing_sessions') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => ({
            maybeSingle: async () => ({ data: this.sessions.get(userId) ?? null, error: null }),
          }),
        }),
        upsert: (payload: Partial<SessionRow> & { user_id: string }) => ({
          select: (_cols: string) => ({
            single: async () => {
              const existing = this.sessions.get(payload.user_id);
              const nowIso = new Date().toISOString();
              const merged: SessionRow = {
                user_id: payload.user_id,
                primary_game_id: payload.primary_game_id ?? existing?.primary_game_id ?? null,
                primary_source: payload.primary_source ?? existing?.primary_source ?? null,
                primary_priority_score:
                  payload.primary_priority_score ?? existing?.primary_priority_score ?? null,
                thumbnail_game_ids: payload.thumbnail_game_ids ?? existing?.thumbnail_game_ids ?? [],
                device_info: payload.device_info ?? existing?.device_info ?? {},
                started_at: payload.started_at ?? existing?.started_at ?? nowIso,
                last_updated_at: payload.last_updated_at ?? existing?.last_updated_at ?? nowIso,
              };
              this.sessions.set(payload.user_id, merged);
              return { data: merged, error: null };
            },
          }),
        }),
        update: (payload: Partial<SessionRow>) => {
          const filters: [keyof SessionRow, unknown][] = [];
          const apply = async () => {
            const userId = filters.find(([column]) => column === 'user_id')?.[1];
            const existing = typeof userId === 'string' ? this.sessions.get(userId) : undefined;
            if (!existing) return { data: null, error: null };
            const matches = filters.every(([column, value]) => existing[column] === value);
            if (!matches) return { data: null, error: null };
            const merged = { ...existing, ...payload };
            this.sessions.set(existing.user_id, merged);
            return { data: merged, error: null };
          };
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column as keyof SessionRow, value]);
              return builder;
            },
            select(_cols: string) {
              return builder;
            },
            maybeSingle() {
              return apply();
            },
            then<TResult1 = { data: SessionRow | null; error: null }, TResult2 = never>(
              onfulfilled?: (
                value: { data: SessionRow | null; error: null },
              ) => TResult1 | PromiseLike<TResult1>,
              onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
            ) {
              return apply().then(onfulfilled, onrejected);
            },
          };
          return builder;
        },
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

const GAME_1 = '11111111-1111-4111-8111-111111111111';
const GAME_2 = '22222222-2222-4222-8222-222222222222';

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_1,
    homeTeamId: 'team-kc',
    awayTeamId: 'team-lv',
    possessionTeamId: 'team-kc',
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 7,
    quarter: 2,
    timeRemainingSec: 500,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

interface TestApp {
  fastify: ReturnType<typeof Fastify>;
  lineupCache: InMemoryLineupCache;
  gameStateStore: InMemoryGameStateStore;
  supabase: FakeSupabase;
}

async function buildTestApp(gameIds: string[] = []): Promise<TestApp> {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: WEEK, seasonType: 'regular', seasonStartDate: null },
    300,
  );
  const gameStateStore = new InMemoryGameStateStore();
  const supabase = new FakeSupabase(gameIds);

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  // Mirrors server.ts's error handler so ApiError (e.g. 404 game_not_found) and Zod validation
  // errors serialize into the Section 9 `{ error: { code, message } }` shape under test too.
  fastify.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: { code: 'validation_error', message: 'Request validation failed.', details: error.validation },
      });
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(toErrorBody(error));
    }
    throw error;
  });

  await fastify.register(authPlugin, {
    jwtSecret: JWT_SECRET,
    supabaseUrl: 'http://127.0.0.1:54321',
  });
  await fastify.register(servicesPlugin, {
    supabase: supabase as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore,
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(sessionRoutes);

  return { fastify, lineupCache, gameStateStore, supabase };
}

async function setLineup(app: TestApp, userId: string): Promise<void> {
  const cache: UserLineupCache = {
    userId,
    week: WEEK,
    teamPositions: new Map([['team-kc', new Set<'offense' | 'defense'>(['offense'])]]),
    playerToTeam: new Map([['player-1', 'team-kc']]),
    starPlayerIds: new Set(),
  };
  await app.lineupCache.setLineupCache(userId, WEEK, cache);
}

describe('session routes', () => {
  let app: TestApp;

  afterEach(async () => {
    vi.useRealTimers();
    await app.fastify.close();
  });

  describe('GET /session', () => {
    it('returns an all-null session for a user who has never started one', async () => {
      app = await buildTestApp();
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        primary_game_id: null,
        primary_source: null,
        primary_priority_score: null,
        thumbnail_game_ids: [],
        started_at: null,
        last_updated_at: null,
      });
    });

    it('rejects an unauthenticated request', async () => {
      app = await buildTestApp();
      const response = await app.fastify.inject({ method: 'GET', url: '/session' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /session/start', () => {
    it('creates a fresh session row with defaults on first start', async () => {
      app = await buildTestApp();
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'POST',
        url: '/session/start',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.primary_game_id).toBeNull();
      expect(body.thumbnail_game_ids).toEqual([]);
      expect(typeof body.started_at).toBe('string');
      expect(typeof body.last_updated_at).toBe('string');
    });

    it('re-touches started_at without clobbering an existing primary game', async () => {
      app = await buildTestApp([GAME_1]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'airplay' },
      });

      const restart = await app.fastify.inject({
        method: 'POST',
        url: '/session/start',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(restart.json().primary_game_id).toBe(GAME_1);
      expect(restart.json().primary_source).toBe('airplay');
    });
  });

  describe('PUT /session/primary', () => {
    it('sets the primary game and computes a fresh priority score', async () => {
      app = await buildTestApp([GAME_1]);
      await setLineup(app, 'user-1');
      await app.gameStateStore.setGameState(GAME_1, makeGameState());
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'deeplink' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.primary_game_id).toBe(GAME_1);
      expect(body.primary_source).toBe('deeplink');
      expect(body.primary_priority_score).toBeGreaterThan(0);
    });

    it('scores 0 when the game has no live GameState yet', async () => {
      app = await buildTestApp([GAME_1]);
      await setLineup(app, 'user-1');
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'chromecast' },
      });

      expect(response.json().primary_priority_score).toBe(0);
    });

    it('rejects a game_id that does not exist', async () => {
      app = await buildTestApp([]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: '00000000-0000-4000-8000-000000000001', source: 'deeplink' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('game_not_found');
    });

    it('rejects a source outside the client-settable enum (e.g. embedded)', async () => {
      app = await buildTestApp([GAME_1]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'embedded' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /session/primary', () => {
    it('clears the primary game and priority score', async () => {
      app = await buildTestApp([GAME_1]);
      await setLineup(app, 'user-1');
      await app.gameStateStore.setGameState(GAME_1, makeGameState());
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'deeplink' },
      });

      const response = await app.fastify.inject({
        method: 'DELETE',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.primary_game_id).toBeNull();
      expect(body.primary_source).toBeNull();
      expect(body.primary_priority_score).toBeNull();
    });

    it('is a no-op returning an empty session when there is nothing to clear', async () => {
      app = await buildTestApp();
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'DELETE',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().primary_game_id).toBeNull();
    });
  });

  describe('POST /session/heartbeat', () => {
    it('marks the user active in Redis with the shared 5-minute TTL', async () => {
      app = await buildTestApp();
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      expect(await app.gameStateStore.isUserActive('user-1')).toBe(false);

      const response = await app.fastify.inject({
        method: 'POST',
        url: '/session/heartbeat',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(await app.gameStateStore.isUserActive('user-1')).toBe(true);
      expect(typeof response.json().active_until).toBe('number');
    });

    it('rejects an unauthenticated request', async () => {
      app = await buildTestApp();
      const response = await app.fastify.inject({ method: 'POST', url: '/session/heartbeat' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('primary watch expiry', () => {
    const T0 = new Date('2026-10-11T16:00:00.000Z');

    async function putPrimary(token: string): Promise<void> {
      const response = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_1, source: 'deeplink' },
      });
      expect(response.statusCode).toBe(200);
    }

    it('keeps the primary on a read within 4 hours of Switch', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      app = await buildTestApp([GAME_1]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' }, '1d');
      await putPrimary(token);

      vi.setSystemTime(new Date(T0.getTime() + PRIMARY_WATCH_MS - 1000));
      const response = await app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.json().primary_game_id).toBe(GAME_1);
    });

    it('reads as none and clears the row when that game is final', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      app = await buildTestApp([GAME_1]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' }, '1d');
      await putPrimary(token);
      app.supabase.setGameStatus(GAME_1, 'final');

      const response = await app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.json().primary_game_id).toBeNull();
      expect(response.json().primary_source).toBeNull();
      expect(response.json().primary_priority_score).toBeNull();
      expect(app.supabase.sessionRow('user-1')?.primary_game_id).toBeNull();
    });

    it('reads as none 4 hours and 1 second after Switch, even if the app was foregrounded', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      app = await buildTestApp([GAME_1]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' }, '1d');
      await putPrimary(token);

      vi.setSystemTime(new Date(T0.getTime() + 30 * 60 * 1000));
      const restart = await app.fastify.inject({
        method: 'POST',
        url: '/session/start',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(restart.json().primary_game_id).toBe(GAME_1);

      vi.setSystemTime(new Date(T0.getTime() + PRIMARY_WATCH_MS + 1000));
      const response = await app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.json().primary_game_id).toBeNull();
      expect(app.supabase.sessionRow('user-1')?.primary_game_id).toBeNull();
    });

    it('keeps a new Switch when it lands before the expired clear runs', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      app = await buildTestApp([GAME_1, GAME_2]);
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' }, '1d');
      await putPrimary(token);

      vi.setSystemTime(new Date(T0.getTime() + PRIMARY_WATCH_MS + 1000));
      const hold = app.supabase.armStatusHold();
      const expiredRead = app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });
      await hold.entered;

      const switched = await app.fastify.inject({
        method: 'PUT',
        url: '/session/primary',
        headers: { authorization: `Bearer ${token}` },
        payload: { game_id: GAME_2, source: 'deeplink' },
      });
      expect(switched.json().primary_game_id).toBe(GAME_2);

      hold.release();
      await expiredRead;

      expect(app.supabase.sessionRow('user-1')?.primary_game_id).toBe(GAME_2);
      const again = await app.fastify.inject({
        method: 'GET',
        url: '/session',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(again.json().primary_game_id).toBe(GAME_2);
    });
  });
});
