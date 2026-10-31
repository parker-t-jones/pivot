import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { ApiError, toErrorBody } from '../lib/errors.js';
import { FEATURE_BETS_INVALID, loadFeatureBets } from '../lib/features.js';
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
  expo_push_device_id?: string | null;
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
  readonly webPush = new Map<
    string,
    {
      user_id: string;
      device_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      user_agent: string | null;
      created_at: string;
      last_success_at: string | null;
    }
  >();
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
            maybeSingle: async () => {
              const existing = this.users.get(userId);
              if (!existing) return { data: null, error: null };
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
          eq: (_col: string, userId: string) =>
            Promise.resolve({
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
    if (table === 'web_push_subscriptions') {
      return {
        upsert: (row: {
          user_id: string;
          device_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
        }) => {
          const existing = this.webPush.get(row.endpoint);
          this.webPush.set(row.endpoint, {
            user_id: row.user_id,
            device_id: row.device_id,
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            auth: row.auth,
            user_agent: row.user_agent,
            created_at: existing?.created_at ?? '2026-10-11T00:00:00.000Z',
            last_success_at: existing?.last_success_at ?? null,
          });
          return Promise.resolve({ error: null });
        },
        delete: () => {
          const filters: [string, string][] = [];
          const builder = {
            eq: (column: string, value: string) => {
              filters.push([column, value]);
              return builder;
            },
            then: (
              resolve: (value: { error: null }) => void,
              reject?: (reason: unknown) => void,
            ) => {
              try {
                const endpoint = filters.find(([column]) => column === 'endpoint')?.[1];
                const userId = filters.find(([column]) => column === 'user_id')?.[1];
                if (endpoint && userId && this.webPush.get(endpoint)?.user_id === userId) {
                  this.webPush.delete(endpoint);
                }
                resolve({ error: null });
              } catch (error) {
                reject?.(error);
              }
            },
          };
          return builder;
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
    expect(app.supabase.users.get('user-1')?.expo_push_device_id ?? null).toBeNull();
  });

  it('stores a deviceId beside the token and treats an omitted one as legacy', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const deviceId = '11111111-1111-4111-8111-111111111111';

    const withDevice = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_TOKEN, platform: 'ios', deviceId },
    });
    expect(withDevice.statusCode).toBe(200);
    expect(app.supabase.users.get('user-1')?.expo_push_device_id).toBe(deviceId);

    const legacy = await app.fastify.inject({
      method: 'POST',
      url: '/me/push-token',
      headers: { authorization: `Bearer ${token}` },
      payload: { token: VALID_TOKEN, platform: 'ios' },
    });
    expect(legacy.statusCode).toBe(200);
    expect(app.supabase.users.get('user-1')?.expo_push_device_id ?? null).toBeNull();
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
        watchOpponent: false,
        watchedLeagueIds: [],
      },
      app_presence: [{ service: 'peacock', has_subscription: true }],
      features: { bets: false },
      is_demo: false,
    });
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /me features.bets', () => {
  const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let app: TestApp;

  afterEach(async () => {
    loadFeatureBets(undefined);
    await app.fastify.close();
  });

  async function readMe(userId: string) {
    app = await buildTestApp(
      {},
      { [userId]: { email: 'a@b.com', subscription_tier: 'pro', preferences: {} } },
      { [userId]: [{ service: 'peacock', has_subscription: true }] },
    );
    const token = await signToken({ sub: userId, email: 'a@b.com' });
    const response = await app.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  function expectRestUnchanged(body: Record<string, unknown>, userId: string) {
    const { features, ...rest } = body;
    expect(rest).toEqual({
      user_id: userId,
      email: 'a@b.com',
      subscription_tier: 'pro',
      preferences: {
        notificationMode: 'all',
        quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
        autoSwitch: false,
        watchOpponent: false,
        watchedLeagueIds: [],
      },
      app_presence: [{ service: 'peacock', has_subscription: true }],
      is_demo: false,
    });
    return features;
  }

  it('is false when FEATURE_BETS is unset, and the rest of the body is unchanged', async () => {
    loadFeatureBets(undefined);
    const body = await readMe('user-1');
    expect(expectRestUnchanged(body, 'user-1')).toEqual({ bets: false });
  });

  it('is false when FEATURE_BETS is off', async () => {
    loadFeatureBets('off');
    const body = await readMe('user-1');
    expect(expectRestUnchanged(body, 'user-1')).toEqual({ bets: false });
  });

  it('is true when FEATURE_BETS is all', async () => {
    loadFeatureBets('all');
    const body = await readMe('user-1');
    expect(expectRestUnchanged(body, 'user-1')).toEqual({ bets: true });
  });

  it('is true for an allowlist hit', async () => {
    loadFeatureBets(ALICE);
    const body = await readMe(ALICE);
    expect(expectRestUnchanged(body, ALICE)).toEqual({ bets: true });
  });

  it('is false for an allowlist miss', async () => {
    loadFeatureBets(ALICE);
    const body = await readMe(BOB);
    expect(expectRestUnchanged(body, BOB)).toEqual({ bets: false });
  });

  it('is false and logs when FEATURE_BETS is invalid', async () => {
    const log = vi.fn();
    loadFeatureBets('yes', log);
    expect(log).toHaveBeenCalledWith(FEATURE_BETS_INVALID);
    const body = await readMe('user-1');
    expect(expectRestUnchanged(body, 'user-1')).toEqual({ bets: false });
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
      watchOpponent: false,
      watchedLeagueIds: [],
    });
    expect(response.json().features).toEqual({ bets: false });
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

  it('accepts watchOpponent and returns it from GET /me', async () => {
    app = await buildTestApp({}, { 'user-1': { preferences: {} } });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const patched = await app.fastify.inject({
      method: 'PATCH',
      url: '/me/preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { watchOpponent: true, notAPreference: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().preferences.watchOpponent).toBe(true);
    expect(Object.hasOwn(patched.json().preferences, 'notAPreference')).toBe(false);

    const fetched = await app.fastify.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().preferences.watchOpponent).toBe(true);
    expect(Object.hasOwn(fetched.json().preferences, 'notAPreference')).toBe(false);
  });
});

describe('POST /me/app-presence', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('upserts services and returns the full merged list', async () => {
    app = await buildTestApp(
      {},
      {},
      { 'user-1': [{ service: 'peacock', has_subscription: false }] },
    );
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

  it('accepts the split user-service keys', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/app-presence',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        services: [
          { service: 'youtube_tv', has_subscription: true },
          { service: 'sunday_ticket', has_subscription: false },
          { service: 'hulu_live', has_subscription: true },
          { service: 'sling', has_subscription: false },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().app_presence).toHaveLength(4);
  });

  it.each(['fox_one', 'cable_other', 'espn'] as const)('accepts %s', async (service) => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/me/app-presence',
      headers: { authorization: `Bearer ${token}` },
      payload: { services: [{ service, has_subscription: true }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().app_presence).toEqual([{ service, has_subscription: true }]);
  });

  it.each(['cbs', 'fox', 'nbc', 'abc', 'nfl_network', 'hulu'])(
    'rejects the retired or network key %s with validation_error',
    async (service) => {
      app = await buildTestApp();
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'POST',
        url: '/me/app-presence',
        headers: { authorization: `Bearer ${token}` },
        payload: { services: [{ service, has_subscription: true }] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
    },
  );

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

const WEB_DEVICE = '22222222-2222-4222-8222-222222222222';
const WEB_ENDPOINT = 'https://push.example.test/subscriptions/1';

describe('POST /me/web-push-subscription', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('upserts by endpoint and keeps the Expo token untouched', async () => {
    app = await buildTestApp({ 'user-1': 'ExponentPushToken[keep]' });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const payload = {
      deviceId: WEB_DEVICE,
      endpoint: WEB_ENDPOINT,
      p256dh: 'p256',
      auth: 'authkey',
    };

    const created = await app.fastify.inject({
      method: 'POST',
      url: '/me/web-push-subscription',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ endpoint: WEB_ENDPOINT, device_id: WEB_DEVICE });
    expect(app.supabase.users.get('user-1')?.expo_push_token).toBe('ExponentPushToken[keep]');

    const moved = await app.fastify.inject({
      method: 'POST',
      url: '/me/web-push-subscription',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, deviceId: '33333333-3333-4333-8333-333333333333', p256dh: 'next' },
    });
    expect(moved.statusCode).toBe(200);
    expect(app.supabase.webPush.size).toBe(1);
    expect(app.supabase.webPush.get(WEB_ENDPOINT)?.device_id).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(app.supabase.webPush.get(WEB_ENDPOINT)?.p256dh).toBe('next');
  });

  it('rejects a non-https endpoint and a missing session', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const httpEndpoint = await app.fastify.inject({
      method: 'POST',
      url: '/me/web-push-subscription',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        deviceId: WEB_DEVICE,
        endpoint: 'http://push.example.test/subscriptions/1',
        p256dh: 'p256',
        auth: 'authkey',
      },
    });
    expect(httpEndpoint.statusCode).toBe(400);

    const anonymous = await app.fastify.inject({
      method: 'POST',
      url: '/me/web-push-subscription',
      payload: {
        deviceId: WEB_DEVICE,
        endpoint: WEB_ENDPOINT,
        p256dh: 'p256',
        auth: 'authkey',
      },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('DELETE /me/web-push-subscription', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('deletes only the caller row for that endpoint', async () => {
    app = await buildTestApp();
    app.supabase.webPush.set(WEB_ENDPOINT, {
      user_id: 'user-1',
      device_id: WEB_DEVICE,
      endpoint: WEB_ENDPOINT,
      p256dh: 'p256',
      auth: 'authkey',
      user_agent: null,
      created_at: '2026-10-11T00:00:00.000Z',
      last_success_at: null,
    });
    app.supabase.webPush.set('https://push.example.test/subscriptions/2', {
      user_id: 'user-2',
      device_id: WEB_DEVICE,
      endpoint: 'https://push.example.test/subscriptions/2',
      p256dh: 'p256',
      auth: 'authkey',
      user_agent: null,
      created_at: '2026-10-11T00:00:00.000Z',
      last_success_at: null,
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'DELETE',
      url: '/me/web-push-subscription',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint: WEB_ENDPOINT },
    });

    expect(response.statusCode).toBe(204);
    expect(app.supabase.webPush.has(WEB_ENDPOINT)).toBe(false);
    expect(app.supabase.webPush.has('https://push.example.test/subscriptions/2')).toBe(true);
  });
});
