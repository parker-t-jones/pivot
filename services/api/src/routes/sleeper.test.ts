import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, toErrorBody } from '../lib/errors.js';
import authPlugin from '../plugins/auth.js';
import {
  sleeperClient,
  type SleeperLeague,
  type SleeperNflState,
  type SleeperUser,
} from '../providers/sleeper-client.js';
import sleeperRoutes from './sleeper.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

const USER: SleeperUser = { user_id: 'sleeper-user-1', username: 'parker', display_name: 'Parker' };

function league(id: string, season: string): SleeperLeague {
  return { league_id: id, name: `League ${id}`, season, roster_positions: [] };
}

function nflState(overrides: Partial<SleeperNflState> = {}): SleeperNflState {
  return { week: 1, season: '2026', previous_season: '2025', season_type: 'regular', ...overrides };
}

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function buildTestApp() {
  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
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

  await fastify.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await fastify.register(sleeperRoutes);
  return fastify;
}

async function getLeagues(app: Awaited<ReturnType<typeof buildTestApp>>) {
  const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
  return await app.inject({
    method: 'GET',
    url: '/sleeper/leagues?username=parker',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /sleeper/leagues', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns current-season leagues without calling for the previous season', async () => {
    app = await buildTestApp();
    vi.spyOn(sleeperClient, 'getUserByUsername').mockResolvedValue(USER);
    // season_type 'off' on purpose: a non-empty current-season result must win even in the offseason.
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue(nflState({ season_type: 'off' }));
    const getUserLeagues = vi
      .spyOn(sleeperClient, 'getUserLeagues')
      .mockResolvedValue([league('l-1', '2026')]);

    const response = await getLeagues(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      leagues: [{ league_id: 'l-1', name: 'League l-1', season: '2026' }],
    });
    expect(getUserLeagues).toHaveBeenCalledTimes(1);
    expect(getUserLeagues).toHaveBeenCalledWith(USER.user_id, '2026');
  });

  it('falls back to previous-season leagues when current season is empty in the offseason', async () => {
    app = await buildTestApp();
    vi.spyOn(sleeperClient, 'getUserByUsername').mockResolvedValue(USER);
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue(nflState({ season_type: 'off' }));
    const getUserLeagues = vi
      .spyOn(sleeperClient, 'getUserLeagues')
      .mockImplementation(async (_userId, season) =>
        season === '2025' ? [league('l-old', '2025')] : [],
      );

    const response = await getLeagues(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      leagues: [{ league_id: 'l-old', name: 'League l-old', season: '2025' }],
    });
    expect(getUserLeagues).toHaveBeenCalledTimes(2);
    expect(getUserLeagues).toHaveBeenNthCalledWith(1, USER.user_id, '2026');
    expect(getUserLeagues).toHaveBeenNthCalledWith(2, USER.user_id, '2025');
  });

  it('returns an empty list with no fallback call when current season is empty in-season', async () => {
    app = await buildTestApp();
    vi.spyOn(sleeperClient, 'getUserByUsername').mockResolvedValue(USER);
    vi.spyOn(sleeperClient, 'getNflState').mockResolvedValue(nflState({ season_type: 'regular' }));
    const getUserLeagues = vi.spyOn(sleeperClient, 'getUserLeagues').mockResolvedValue([]);

    const response = await getLeagues(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ leagues: [] });
    expect(getUserLeagues).toHaveBeenCalledTimes(1);
    expect(getUserLeagues).toHaveBeenCalledWith(USER.user_id, '2026');
  });

  it('throws 404 sleeper_user_not_found for an unknown username with no season calls', async () => {
    app = await buildTestApp();
    vi.spyOn(sleeperClient, 'getUserByUsername').mockResolvedValue(null);
    const getNflState = vi.spyOn(sleeperClient, 'getNflState');
    const getUserLeagues = vi.spyOn(sleeperClient, 'getUserLeagues');

    const response = await getLeagues(app);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('sleeper_user_not_found');
    expect(getNflState).not.toHaveBeenCalled();
    expect(getUserLeagues).not.toHaveBeenCalled();
  });
});
