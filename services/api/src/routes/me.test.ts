import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@roster-remote/dispatcher';
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
  id?: string;
  email?: string;
  subscription_tier?: string;
  preferences?: unknown;
  expo_push_token: string | null;
}

interface AppPresenceRow {
  service: string;
  has_subscription: boolean;
}

/** Small stateful stand-in for `public.users` / `public.user_app_presence` — enough to exercise the
 *  update/select-by-id chains these routes depend on (mirrors `session.test.ts`'s `FakeSupabase`). */
class FakeSupabase {
  readonly users: Map<string, UserRow>;
  readonly appPresence: Map<string, AppPresenceRow[]>;
  readonly deletedAuthUserIds: string[] = [];
  authDeleteError: { message: string } | null = null;

  readonly auth = {
    admin: {
      deleteUser: async (userId: string) => {
        if (this.authDeleteError) return { data: null, error: this.authDeleteError };
        this.deletedAuthUserIds.push(userId);
        this.users.delete(userId);
        return { data: {}, error: null };
      },
    },
  };

  constructor(
    seed: Record<string, string | null> = {},
    userRows: Record<string, Partial<UserRow>> = {},
    appPresence: Record<string, AppPresenceRow[]> = {},
  ) {
    const ids = new Set([...Object.keys(seed), ...Object.keys(userRows)]);
    this.users = new Map(
      [...ids].map((id) => [
        id,
        {
          id,
          email: `${id}@example.com`,
          subscription_tier: 'free',
          preferences: {},
          expo_push_token: seed[id] ?? null,
          ...userRows[id],
        },
      ]),
    );
    this.appPresence = new Map(Object.entries(appPresence));
  }

  from(table: string) {
    if (table === 'users') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => ({
            single: async () => {
              const existing = this.users.get(userId);
              if (!existing) return { data: null, error: { message: 'not found' } };
              return { data: existing, error: null };
            },
          }),
        }),
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
    if (table === 'user_app_presence') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => Promise.resolve({
            data: this.appPresence.get(userId) ?? [],
            error: null,
          }),
        }),
        upsert: (
          rows: { user_id: string; service: string; has_subscription: boolean }[],
          _opts: { onConflict: string },
        ) => {
          for (const row of rows) {
            const existing = this.appPresence.get(row.user_id) ?? [];
            const withoutThisService = existing.filter((r) => r.service !== row.service);
            this.appPresence.set(row.user_id, [
              ...withoutThisService,
              { service: row.service, has_subscription: row.has_subscription },
            ]);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

interface TestApp {
  fastify: ReturnType<typeof Fastify>;
  supabase: FakeSupabase;
}

async function buildTestApp(
  seed: Record<string, string | null> = {},
  userRows: Record<string, Partial<UserRow>> = {},
  appPresence: Record<string, AppPresenceRow[]> = {},
): Promise<TestApp> {
  const supabase = new FakeSupabase(seed, userRows, appPresence);

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

describe('GET /me', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('returns the user, defaulted preferences, and app presence rows', async () => {
    app = await buildTestApp(
      {},
      { 'user-1': { email: 'a@b.com', subscription_tier: 'pro', preferences: {} } },
      { 'user-1': [{ service: 'peacock', has_subscription: true }] },
    );
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user_id: 'user-1',
      email: 'a@b.com',
      subscription_tier: 'pro',
      preferences: {
        notificationMode: 'all',
        quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
        autoSwitch: false,
      },
      app_presence: [{ service: 'peacock', has_subscription: true }],
    });
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
  });
});

describe('PATCH /me/preferences', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('merges a partial update over existing preferences without resetting other fields', async () => {
    app = await buildTestApp(
      {},
      {
        'user-1': {
          preferences: { notificationMode: 'all', autoSwitch: true },
        },
      },
    );
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { notificationMode: 'high_leverage_only' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().preferences).toEqual({
      notificationMode: 'high_leverage_only',
      quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
      autoSwitch: true, // untouched by this PATCH
    });
  });

  it('merges a partial quietHours update without resetting its other sub-fields', async () => {
    app = await buildTestApp(
      {},
      {
        'user-1': {
          preferences: { quietHours: { enabled: true, startHour: 23, endHour: 7 } },
        },
      },
    );
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { quietHours: { enabled: false } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().preferences.quietHours).toEqual({
      enabled: false,
      startHour: 23,
      endHour: 7,
      timezone: 'America/New_York',
    });
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({
      method: 'PATCH',
      url: '/me/preferences',
      payload: { notificationMode: 'off' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /me/app-presence', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('upserts services and returns the full merged list', async () => {
    app = await buildTestApp({}, {}, { 'user-1': [{ service: 'peacock', has_subscription: false }] });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/app-presence',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        services: [
          { service: 'peacock', has_subscription: true },
          { service: 'espn_plus', has_subscription: true },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().app_presence).toEqual(
      expect.arrayContaining([
        { service: 'peacock', has_subscription: true },
        { service: 'espn_plus', has_subscription: true },
      ]),
    );
    expect(response.json().app_presence).toHaveLength(2);
  });

  it('rejects an unknown service with validation_error', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/app-presence',
      headers: { authorization: `Bearer ${token}` },
      payload: { services: [{ service: 'not_a_real_service', has_subscription: true }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/app-presence',
      payload: { services: [{ service: 'peacock', has_subscription: true }] },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /me', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('deletes the auth user (cascades cover the rest) and returns 204', async () => {
    app = await buildTestApp({ 'user-1': null });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'DELETE',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
    expect(app.supabase.deletedAuthUserIds).toEqual(['user-1']);
  });

  it('surfaces an admin API failure as account_deletion_failed rather than a generic 500', async () => {
    app = await buildTestApp({ 'user-1': null });
    app.supabase.authDeleteError = { message: 'admin API unreachable' };
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'DELETE',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('account_deletion_failed');
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'DELETE', url: '/me' });
    expect(response.statusCode).toBe(401);
  });
});
