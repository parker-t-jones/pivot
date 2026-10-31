import {
  InMemoryGameStateStore,
  InMemoryRateLimitStore,
  InMemoryRealtimeBus,
  isInQuietHours,
  shouldRateLimit,
} from '@pivot/dispatcher';
import { parsePreferences } from '@pivot/shared';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { resetDemoAlertRateLimit } from '../lib/demoAlert.js';
import { DEMO_LIVE_GAME_ID, demoAlertEvent } from '../lib/demoFixture.js';
import { apiErrorHandler } from '../lib/errors.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import gamesRoutes from './games.js';
import meRoutes from './me.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER_ID = 'user-1';
const REAL_GAME_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface GameRow {
  id: string;
  week: number;
  season_type: string;
  status: string;
  scheduled_start: string;
  home_team_id: string;
  away_team_id: string;
}

interface UserRow {
  id: string;
  is_demo: boolean;
  email: string;
  expo_push_token: string | null;
  expo_push_device_id: string | null;
  preferences: unknown;
  subscription_tier: string;
}

class FakeSupabase {
  constructor(
    private readonly user: UserRow,
    private readonly games: GameRow[],
    private readonly presence: { service: string; has_subscription: boolean }[],
  ) {}

  from(table: string) {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: this.user, error: null }),
            single: async () => ({ data: this.user, error: null }),
          }),
        }),
      };
    }
    if (table === 'user_app_presence') {
      return {
        select: () => ({
          eq: async () => ({ data: this.presence, error: null }),
        }),
      };
    }
    if (table === 'games') return gamesQuery(this.games);
    if (table === 'teams' || table === 'game_airings') {
      return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
    }
    if (table === 'user_game_links') {
      return {
        select: () => ({
          eq: () => ({ in: async () => ({ data: [], error: null }) }),
        }),
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

function gamesQuery(rows: GameRow[]) {
  const filters: { week?: number; status?: string; season_type?: string } = {};
  const matched = () =>
    rows.filter((row) => {
      if (filters.week !== undefined && row.week !== filters.week) return false;
      if (filters.status !== undefined && row.status !== filters.status) return false;
      if (filters.season_type !== undefined && row.season_type !== filters.season_type)
        return false;
      return true;
    });
  const builder = {
    select: () => builder,
    eq: (col: string, value: string | number) => {
      if (col === 'week') filters.week = Number(value);
      if (col === 'status') filters.status = String(value);
      if (col === 'season_type') filters.season_type = String(value);
      return builder;
    },
    order: () => ({
      then: (onfulfilled?: (value: { data: GameRow[]; error: null }) => unknown) =>
        Promise.resolve({ data: matched(), error: null }).then(onfulfilled),
      limit: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  };
  return builder;
}

function userRow(isDemo: boolean, token: string | null, preferences: unknown = {}): UserRow {
  return {
    id: USER_ID,
    is_demo: isDemo,
    email: 'a@b.com',
    expo_push_token: token,
    expo_push_device_id: null,
    preferences,
    subscription_tier: 'free',
  };
}

const REAL_GAME: GameRow = {
  id: REAL_GAME_ID,
  week: 1,
  season_type: 'regular',
  status: 'scheduled',
  scheduled_start: '2026-09-10T00:20:00.000Z',
  home_team_id: 'home',
  away_team_id: 'away',
};

async function signToken(): Promise<string> {
  return await new SignJWT({ sub: USER_ID, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function buildApp(user: UserRow, presence: { service: string; has_subscription: boolean }[]) {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: 1, seasonType: 'regular', seasonStartDate: null },
    300,
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
    supabase: new FakeSupabase(user, [REAL_GAME], presence) as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(gamesRoutes);
  await fastify.register(meRoutes);
  return fastify;
}

describe('demo account does not change a normal user', () => {
  let previousPushDriver: string | undefined;

  beforeEach(() => {
    previousPushDriver = process.env['PUSH_DRIVER'];
    process.env['PUSH_DRIVER'] = 'none';
    resetDemoAlertRateLimit();
  });

  afterEach(() => {
    if (previousPushDriver === undefined) delete process.env['PUSH_DRIVER'];
    else process.env['PUSH_DRIVER'] = previousPushDriver;
  });

  it('serves GET /games and GET /games/live from the normal handler and 404s POST /me/demo-alert', async () => {
    const fastify = await buildApp(userRow(false, null), []);
    const token = await signToken();
    const headers = { authorization: `Bearer ${token}` };

    const week = await fastify.inject({ method: 'GET', url: '/games?week=1', headers });
    expect(week.statusCode).toBe(200);
    const weekIds = (week.json() as { games: { game_id: string }[] }).games.map(
      (game) => game.game_id,
    );
    expect(weekIds).toEqual([REAL_GAME_ID]);

    const live = await fastify.inject({ method: 'GET', url: '/games/live', headers });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ games: [] });

    const alert = await fastify.inject({ method: 'POST', url: '/me/demo-alert', headers });
    expect(alert.statusCode).toBe(404);
    expect(alert.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });

    await fastify.close();
  });

  it('serves the fixture slate for a demo user, and distinguishes a missing token from the rate limit', async () => {
    const weekApp = await buildApp(userRow(true, null), [
      { service: 'directv', has_subscription: true },
    ]);
    const headers = { authorization: `Bearer ${await signToken()}` };
    const week = await weekApp.inject({ method: 'GET', url: '/games?week=1', headers });
    expect(week.statusCode).toBe(200);
    const games = (week.json() as { games: { game_id: string; destination: unknown }[] }).games;
    expect(games.map((game) => game.game_id)).toContain(DEMO_LIVE_GAME_ID);
    expect(games.map((game) => game.game_id)).not.toContain(REAL_GAME_ID);
    expect(games[0]?.destination).toMatchObject({
      kind: 'destinations',
      primary: { url: 'https://www.cbs.com/live-tv/stream/' },
    });
    const missingToken = await weekApp.inject({ method: 'POST', url: '/me/demo-alert', headers });
    expect(missingToken.statusCode).toBe(409);
    expect(missingToken.json().error.code).toBe('demo_alert_no_token');
    await weekApp.close();

    const pushApp = await buildApp(userRow(true, 'ExponentPushToken[demo]'), [
      { service: 'directv', has_subscription: true },
    ]);
    const pushHeaders = { authorization: `Bearer ${await signToken()}` };
    for (let i = 0; i < 3; i += 1) {
      const sent = await pushApp.inject({
        method: 'POST',
        url: '/me/demo-alert',
        headers: pushHeaders,
      });
      expect(sent.statusCode, sent.body).toBe(200);
    }
    const limited = await pushApp.inject({
      method: 'POST',
      url: '/me/demo-alert',
      headers: pushHeaders,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('demo_alert_rate_limited');
    await pushApp.close();
  });

  it('sends a demo alert while quiet hours are on and notifications are off', async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const preferences = {
      notificationMode: 'off',
      quietHours: {
        enabled: true,
        startHour: hour,
        endHour: (hour + 1) % 24,
        timezone: 'UTC',
      },
    };
    const parsed = parsePreferences(preferences);
    expect(isInQuietHours(parsed, now)).toBe(true);
    expect(
      await shouldRateLimit(
        demoAlertEvent(USER_ID, now),
        parsed,
        new InMemoryRateLimitStore(),
        now.getTime(),
      ),
    ).toBe(true);

    const fastify = await buildApp(userRow(true, 'ExponentPushToken[demo]', preferences), [
      { service: 'directv', has_subscription: true },
    ]);
    const sent = await fastify.inject({
      method: 'POST',
      url: '/me/demo-alert',
      headers: { authorization: `Bearer ${await signToken()}` },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({ sent: true });
    await fastify.close();
  });
});
