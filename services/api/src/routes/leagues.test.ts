import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@roster-remote/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { apiErrorHandler } from '../lib/errors.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import leaguesRoutes from './leagues.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER_ID = 'user-1';
const MANUAL_ID = '11111111-1111-4111-8111-111111111111';
const SLEEPER_ID = '22222222-2222-4222-8222-222222222222';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface LeagueRow {
  id: string;
  user_id: string;
  platform: string;
  name: string;
  sport: string;
  season_year: number;
  last_synced_at: string | null;
  external_league_id: string | null;
  external_owner_id: string | null;
  external_roster_id: string | null;
  created_at: string;
}

class FakeSupabase {
  readonly leagues: Map<string, LeagueRow>;

  constructor(seed: LeagueRow[]) {
    this.leagues = new Map(seed.map((row) => [row.id, row]));
  }

  from(table: string) {
    if (table !== 'leagues') {
      throw new Error(`Unexpected table in test fixture: ${table}`);
    }
    return {
      select: (_cols: string) => ({
        eq: (col: string, value: string) => ({
          single: async () => {
            if (col !== 'id') throw new Error(`Unexpected eq column: ${col}`);
            const row = this.leagues.get(value);
            if (!row) return { data: null, error: { message: 'not found' } };
            return { data: row, error: null };
          },
        }),
      }),
      update: (payload: Partial<LeagueRow>) => ({
        eq: (col: string, value: string) => ({
          select: (_cols: string) => ({
            single: async () => {
              if (col !== 'id') throw new Error(`Unexpected eq column: ${col}`);
              const existing = this.leagues.get(value);
              if (!existing) return { data: null, error: { message: 'not found' } };
              const merged = { ...existing, ...payload };
              this.leagues.set(value, merged);
              return { data: merged, error: null };
            },
          }),
        }),
      }),
    };
  }
}

function seedLeague(overrides: Partial<LeagueRow> & Pick<LeagueRow, 'id' | 'platform' | 'name'>): LeagueRow {
  return {
    user_id: USER_ID,
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
    external_league_id: null,
    external_owner_id: null,
    external_roster_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

async function buildTestApp(seed: LeagueRow[]) {
  const fake = new FakeSupabase(seed);
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
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(leaguesRoutes);
  return { fastify, fake };
}

describe('PATCH /leagues/:id', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('renames a manual league and returns the summary', async () => {
    app = await buildTestApp([
      seedLeague({ id: MANUAL_ID, platform: 'manual', name: 'Old Name' }),
    ]);
    const token = await signToken({ sub: USER_ID, email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'PATCH',
      url: `/leagues/${MANUAL_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '  New Name  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      league_id: MANUAL_ID,
      platform: 'manual',
      name: 'New Name',
      sport: 'nfl',
      season_year: 2026,
      last_synced_at: null,
    });
    expect(app.fake.leagues.get(MANUAL_ID)?.name).toBe('New Name');
  });

  it('rejects Sleeper leagues with manual_league_only (not manual_lineup_only)', async () => {
    app = await buildTestApp([
      seedLeague({
        id: SLEEPER_ID,
        platform: 'sleeper',
        name: 'Sleeper League',
        external_league_id: 'ext-1',
      }),
    ]);
    const token = await signToken({ sub: USER_ID, email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'PATCH',
      url: `/leagues/${SLEEPER_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Local rename' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'manual_league_only',
        message: 'Only manual leagues can be renamed — Sleeper league names come from Sleeper.',
      },
    });
    expect(app.fake.leagues.get(SLEEPER_ID)?.name).toBe('Sleeper League');
  });

  it('returns 404 for an unknown league', async () => {
    app = await buildTestApp([]);
    const token = await signToken({ sub: USER_ID, email: 'a@b.com' });
    const response = await app.fastify.inject({
      method: 'PATCH',
      url: `/leagues/${MANUAL_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nope' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('league_not_found');
  });
});
