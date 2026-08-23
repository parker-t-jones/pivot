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
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { ApiError, toErrorBody } from '../lib/errors.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import sessionRoutes from './session.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const WEEK = 5;

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
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
  private readonly games: Set<string>;

  constructor(gameIds: string[] = []) {
    this.games = new Set(gameIds);
  }

  from(table: string) {
    if (table === 'games') {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({ data: this.games.has(id) ? { id } : null, error: null }),
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
        update: (payload: Partial<SessionRow>) => ({
          eq: (_col: string, userId: string) => ({
            select: (_cols: string) => ({
              maybeSingle: async () => {
                const existing = this.sessions.get(userId);
                if (!existing) return { data: null, error: null };
                const merged = { ...existing, ...payload };
                this.sessions.set(userId, merged);
                return { data: merged, error: null };
              },
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

const GAME_1 = '11111111-1111-4111-8111-111111111111';

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
}

async function buildTestApp(gameIds: string[] = []): Promise<TestApp> {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: WEEK, seasonType: 'regular', seasonStartDate: null },
    300,
  );
  const gameStateStore = new InMemoryGameStateStore();

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
    supabase: new FakeSupabase(gameIds) as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore,
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(sessionRoutes);

  return { fastify, lineupCache, gameStateStore };
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
});
