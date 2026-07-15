import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@fantasy-focus/dispatcher';
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
import meRoutes from './me.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface UserRow {
  expo_push_token: string | null;
}

/** Small stateful stand-in for `public.users` — enough to exercise the update-by-id chain this
 *  route depends on (mirrors `session.test.ts`'s `FakeSupabase`). */
class FakeSupabase {
  readonly users: Map<string, UserRow>;

  constructor(seed: Record<string, string | null> = {}) {
    this.users = new Map(
      Object.entries(seed).map(([id, token]) => [id, { expo_push_token: token }]),
    );
  }

  from(table: string) {
    if (table === 'users') {
      return {
        update: (payload: Partial<UserRow>) => ({
          eq: (_col: string, userId: string) => ({
            select: (_cols: string) => ({
              single: async () => {
                const existing = this.users.get(userId) ?? { expo_push_token: null };
                const merged: UserRow = { ...existing, ...payload };
                this.users.set(userId, merged);
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

interface TestApp {
  fastify: ReturnType<typeof Fastify>;
  supabase: FakeSupabase;
}

async function buildTestApp(seed: Record<string, string | null> = {}): Promise<TestApp> {
  const supabase = new FakeSupabase(seed);

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  // Mirrors server.ts's error handler (Section 9 `{ error: { code, message } }` shape under test).
  fastify.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed.',
          details: error.validation,
        },
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
    lineupCache: new InMemoryLineupCache(),
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(meRoutes);

  return { fastify, supabase };
}

const VALID_TOKEN = 'ExponentPushToken[abc123DEF456]';
const VALID_LEGACY_TOKEN = 'ExpoPushToken[abc123DEF456]';

describe('POST /me/push-token', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('registers a valid ExponentPushToken and echoes it back', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_TOKEN, platform: 'ios' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expo_push_token: VALID_TOKEN });
    expect(app.supabase.users.get('user-1')?.expo_push_token).toBe(VALID_TOKEN);
  });

  it('also accepts the legacy ExpoPushToken[...] format', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_LEGACY_TOKEN, platform: 'ios' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expo_push_token: VALID_LEGACY_TOKEN });
  });

  it('rejects platform: "android" with unsupported_platform, not a generic validation error', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_TOKEN, platform: 'android' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('unsupported_platform');
    expect(app.supabase.users.get('user-1')).toBeUndefined(); // never reached the DB write
  });

  it('rejects a platform outside the known enum with the generic validation_error', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_TOKEN, platform: 'web' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('rejects a malformed token with invalid_push_token before writing to the DB', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: 'not-a-real-token', platform: 'ios' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_push_token');
    expect(app.supabase.users.get('user-1')).toBeUndefined();
  });

  it('rejects a bare-UUID token even though expo-server-sdk itself would accept it', async () => {
    // Deliberately narrower than `Expo.isExpoPushToken` (see me.ts's docstring) — a bare UUID isn't
    // one of the two bracketed formats Sprint 6 Phase 4 specified.
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: '123e4567-e89b-12d3-a456-426614174000', platform: 'ios' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_push_token');
  });

  it('rejects a request missing the token field with validation_error', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: 'ios' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      payload: { token: VALID_TOKEN, platform: 'ios' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /me/push-token', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('clears an existing token', async () => {
    app = await buildTestApp({ 'user-1': VALID_TOKEN });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'DELETE',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expo_push_token: null });
    expect(app.supabase.users.get('user-1')?.expo_push_token).toBeNull();
  });

  it('is a no-op (still 200, still null) when the user has no token set', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'DELETE',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ expo_push_token: null });
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'DELETE', url: '/me/push-token' });
    expect(response.statusCode).toBe(401);
  });
});
