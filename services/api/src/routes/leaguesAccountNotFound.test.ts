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
import { unreachableNflStateSource } from '../lib/nflStateSource.test-helper.js';
import { sleeperProvider, type SleeperLeagueConnection } from '../providers/index.js';
import leaguesRoutes from './leagues.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

/** The JWT is valid but `public.users` has no matching row — a deleted account whose
 *  already-issued access token hasn't expired yet (Issue #46). */
const GHOST_USER_ID = 'ghost-user';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** Just enough of `public.leagues` / `public.users` for `POST /leagues/sleeper` to reach its own
 *  `users` lookup — every caller here is `GHOST_USER_ID`, so `users` always reports "0 rows". */
class FakeSupabase {
  from(table: string) {
    if (table === 'leagues') {
      return {
        select: (_cols: string) => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'users') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => ({
            // `userIsDemo`'s preHandler check — 0 rows is not an error for `maybeSingle()`.
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => {
              if (userId === GHOST_USER_ID) {
                return { data: null, error: { code: 'PGRST116', message: 'no rows found' } };
              }
              return { data: { subscription_tier: 'free' }, error: null };
            },
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

async function buildTestApp() {
  const fake = new FakeSupabase();
  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(apiErrorHandler);

  await fastify.register(authPlugin, {
    jwtSecret: JWT_SECRET,
    supabaseUrl: 'http://127.0.0.1:54321',
  });
  await fastify.register(servicesPlugin, {
    supabase: fake as unknown as SupabaseServiceClient,
    lineupCache: new InMemoryLineupCache(),
    nflStateSource: unreachableNflStateSource,
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(leaguesRoutes);
  return fastify;
}

describe('POST /leagues/sleeper — Issue #46', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns 401 account_not_found, not a 500, when the JWT outlives the account', async () => {
    const connection: SleeperLeagueConnection = {
      externalLeagueId: 'sleeper-league-1',
      externalOwnerId: 'sleeper-owner-1',
      externalRosterId: 'sleeper-roster-1',
      name: 'Ghost League',
      seasonYear: 2026,
    };
    vi.spyOn(sleeperProvider, 'resolveLeagueConnection').mockResolvedValue(connection);

    app = await buildTestApp();
    const token = await signToken({ sub: GHOST_USER_ID, email: 'ghost@example.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/leagues/sleeper',
      headers: { authorization: `Bearer ${token}` },
      payload: { sleeper_username: 'ghost', league_id: 'sleeper-league-1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: 'account_not_found',
        message: "Your account isn't available anymore. Please sign in again.",
      },
    });
  });
});
