import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@roster-remote/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import stateRoutes from './state.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

class FakeGamesSupabase {
  constructor(
    private readonly earliestByType: Partial<Record<'pre' | 'regular', string | null>>,
  ) {}

  from(table: string) {
    if (table !== 'games') {
      throw new Error(`Unexpected table: ${table}`);
    }
    let seasonType: 'pre' | 'regular' | null = null;
    const builder = {
      select: () => builder,
      eq: (col: string, value: string) => {
        if (col === 'season_type') seasonType = value as 'pre' | 'regular';
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const start =
          seasonType === 'pre' || seasonType === 'regular'
            ? this.earliestByType[seasonType]
            : null;
        return {
          data: start ? { scheduled_start: start } : null,
          error: null,
        };
      },
    };
    return builder;
  }
}

async function buildTestApp(options: {
  nflState: {
    season: string;
    week: number;
    seasonType: 'pre' | 'regular' | 'post' | 'off';
    seasonStartDate: string | null;
  };
  earliestByType?: Partial<Record<'pre' | 'regular', string | null>>;
}) {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(options.nflState, 300);

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await fastify.register(servicesPlugin, {
    supabase: new FakeGamesSupabase(options.earliestByType ?? {}) as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(stateRoutes);
  return fastify;
}

describe('GET /state/nfl', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({
      nflState: { season: '2026', week: 0, seasonType: 'off', seasonStartDate: null },
    });
    const response = await app.inject({ method: 'GET', url: '/state/nfl' });
    expect(response.statusCode).toBe(401);
  });

  it('returns null openers and falls display_phase back to season_type', async () => {
    app = await buildTestApp({
      nflState: { season: '2026', week: 0, seasonType: 'off', seasonStartDate: null },
      earliestByType: {},
    });
    const warnSpy = vi.spyOn(app.log, 'warn');
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: '/state/nfl',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      season: '2026',
      week: 0,
      season_type: 'off',
      season_start_date: null,
      preseason_start: null,
      regular_season_start: null,
      display_phase: 'off',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        preseason_start: null,
        regular_season_start: null,
        season_type: 'off',
      }),
      expect.stringContaining('pnpm seed:schedule'),
    );
  });

  it('on Aug 3 ET with openers Aug 6 / Sep 9: display_phase is off despite season_type pre', async () => {
    // Fixed clock: 2026-08-03 15:00 UTC = still Aug 3 in ET.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T15:00:00.000Z'));

    app = await buildTestApp({
      nflState: {
        season: '2026',
        week: 0,
        seasonType: 'pre', // Sleeper already ahead — must not drive display
        seasonStartDate: '2026-08-06',
      },
      earliestByType: {
        pre: '2026-08-07T00:00:00.000Z',
        regular: '2026-09-10T00:20:00.000Z',
      },
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const warnSpy = vi.spyOn(app.log, 'warn');

    const response = await app.inject({
      method: 'GET',
      url: '/state/nfl',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      season: '2026',
      week: 0,
      season_type: 'pre',
      season_start_date: '2026-08-06',
      preseason_start: '2026-08-06',
      regular_season_start: '2026-09-09',
      display_phase: 'off',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
