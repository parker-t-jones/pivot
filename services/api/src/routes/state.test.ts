import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@fantasy-focus/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
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

async function buildTestApp(nflState: {
  season: string;
  week: number;
  seasonType: 'pre' | 'regular' | 'post' | 'off';
  seasonStartDate: string | null;
}) {
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(nflState, 300);

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await fastify.register(servicesPlugin, {
    supabase: { from: () => {
      throw new Error('GET /state/nfl must not hit Supabase');
    } } as unknown as SupabaseServiceClient,
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
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({
      season: '2026',
      week: 0,
      seasonType: 'off',
      seasonStartDate: null,
    });
    const response = await app.inject({ method: 'GET', url: '/state/nfl' });
    expect(response.statusCode).toBe(401);
  });

  it('returns season metadata including a null season_start_date (expected offseason case)', async () => {
    app = await buildTestApp({
      season: '2026',
      week: 0,
      seasonType: 'off',
      seasonStartDate: null,
    });
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
    });
  });

  it('passes through a non-null season_start_date when cached', async () => {
    app = await buildTestApp({
      season: '2026',
      week: 1,
      seasonType: 'regular',
      seasonStartDate: '2026-09-10',
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: '/state/nfl',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      season: '2026',
      week: 1,
      season_type: 'regular',
      season_start_date: '2026-09-10',
    });
  });
});
