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
import gamesRoutes from './games.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const GAME_1 = '11111111-1111-4111-8111-111111111111';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface BroadcastRow {
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
}

interface PresenceRow {
  service: string;
  has_subscription: boolean;
}

/** Minimal stand-in for the `games`/`game_broadcasts`/`user_app_presence` reads this route makes. */
class FakeSupabase {
  constructor(
    private readonly games: Set<string>,
    private readonly broadcasts: Map<string, BroadcastRow[]>,
    private readonly presence: Map<string, PresenceRow[]>,
  ) {}

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
    if (table === 'game_broadcasts') {
      return {
        select: () => ({
          eq: async (_col: string, gameId: string) => ({
            data: this.broadcasts.get(gameId) ?? [],
            error: null,
          }),
        }),
      };
    }
    if (table === 'user_app_presence') {
      return {
        select: () => ({
          eq: async (_col: string, userId: string) => ({
            data: this.presence.get(userId) ?? [],
            error: null,
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }
}

interface FixtureOptions {
  games?: string[];
  broadcasts?: Map<string, BroadcastRow[]>;
  presence?: Map<string, PresenceRow[]>;
}

async function buildTestApp(options: FixtureOptions = {}) {
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
  await fastify.register(servicesPlugin, {
    supabase: new FakeSupabase(
      new Set(options.games ?? []),
      options.broadcasts ?? new Map(),
      options.presence ?? new Map(),
    ) as unknown as SupabaseServiceClient,
    lineupCache: new InMemoryLineupCache(),
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(gamesRoutes);
  return fastify;
}

describe('GET /games/:id/broadcasts', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({ games: [GAME_1] });
    const response = await app.inject({ method: 'GET', url: `/games/${GAME_1}/broadcasts` });
    expect(response.statusCode).toBe(401);
  });

  it('404s for a game that does not exist', async () => {
    app = await buildTestApp({ games: [] });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('game_not_found');
  });

  it('returns an empty broadcast list for a game with no broadcasts', async () => {
    app = await buildTestApp({ games: [GAME_1] });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ game_id: GAME_1, broadcasts: [] });
  });

  it('ranks broadcasts by eligibility then lag, marking exactly one preferred', async () => {
    app = await buildTestApp({
      games: [GAME_1],
      broadcasts: new Map([
        [
          GAME_1,
          [
            { service: 'sunday_ticket', deep_link_url: 'https://st/g1', requires_subscription: true },
            { service: 'fox', deep_link_url: 'https://fox/g1', requires_subscription: false },
          ],
        ],
      ]),
      presence: new Map([['user-1', [{ service: 'sunday_ticket', has_subscription: true }]]]),
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      game_id: GAME_1,
      broadcasts: [
        {
          service: 'fox',
          deep_link_url: 'https://fox/g1',
          requires_subscription: false,
          user_has_subscription: false,
          typical_lag_seconds: 8,
          preferred: true,
        },
        {
          service: 'sunday_ticket',
          deep_link_url: 'https://st/g1',
          requires_subscription: true,
          user_has_subscription: true,
          typical_lag_seconds: 75,
          preferred: false,
        },
      ],
    });
  });

  it('marks a paid broadcast ineligible and unpreferred when the user is not subscribed', async () => {
    app = await buildTestApp({
      games: [GAME_1],
      broadcasts: new Map([
        [
          GAME_1,
          [{ service: 'sunday_ticket', deep_link_url: 'https://st/g1', requires_subscription: true }],
        ],
      ]),
      // A presence row exists but has_subscription is false -> not subscribed.
      presence: new Map([['user-1', [{ service: 'sunday_ticket', has_subscription: false }]]]),
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const { broadcasts } = response.json();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].user_has_subscription).toBe(false);
    expect(broadcasts[0].preferred).toBe(false);
  });
});
