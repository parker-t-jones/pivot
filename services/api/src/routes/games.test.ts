import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@fantasy-focus/dispatcher';
import type { GameState } from '@fantasy-focus/shared';
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
const GAME_2 = '22222222-2222-4222-8222-222222222222';
const TEAM_HOME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEAM_AWAY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_HOME_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEAM_AWAY_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface GameRow {
  id: string;
  week: number;
  season_type?: string;
  status: string;
  scheduled_start: string;
  home_team_id: string;
  away_team_id: string;
}

interface TeamRow {
  id: string;
  abbreviation: string;
  name: string;
  primary_color: string;
  secondary_color: string;
}

interface BroadcastRow {
  game_id: string;
  service: string;
  deep_link_url: string;
  requires_subscription: boolean;
}

interface PresenceRow {
  service: string;
  has_subscription: boolean;
}

interface FakeTables {
  games: GameRow[];
  teams: TeamRow[];
  broadcasts: BroadcastRow[];
  presence: Map<string, PresenceRow[]>;
}

/** Counts `user_app_presence` reads so week-slate tests can assert a single presence load. */
class FakeSupabase {
  presenceReads = 0;

  constructor(private readonly tables: FakeTables) {}

  from(table: string) {
    if (table === 'games') {
      return this.gamesQuery();
    }
    if (table === 'teams') {
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: this.tables.teams.filter((t) => ids.includes(t.id)),
            error: null,
          }),
        }),
      };
    }
    if (table === 'game_broadcasts') {
      return {
        select: () => ({
          eq: async (_col: string, gameId: string) => ({
            data: this.tables.broadcasts
              .filter((b) => b.game_id === gameId)
              .map(({ service, deep_link_url, requires_subscription }) => ({
                service,
                deep_link_url,
                requires_subscription,
              })),
            error: null,
          }),
          in: async (_col: string, gameIds: string[]) => ({
            data: this.tables.broadcasts.filter((b) => gameIds.includes(b.game_id)),
            error: null,
          }),
        }),
      };
    }
    if (table === 'user_app_presence') {
      return {
        select: () => ({
          eq: async (_col: string, userId: string) => {
            this.presenceReads += 1;
            return { data: this.tables.presence.get(userId) ?? [], error: null };
          },
        }),
      };
    }
    throw new Error(`Unexpected table in test fixture: ${table}`);
  }

  private gamesQuery() {
    const rows = this.tables.games;
    const run = (filters: { week?: number; status?: string; id?: string; season_type?: string }) => {
      let filtered = rows;
      if (filters.week !== undefined) filtered = filtered.filter((g) => g.week === filters.week);
      if (filters.status !== undefined) filtered = filtered.filter((g) => g.status === filters.status);
      if (filters.id !== undefined) filtered = filtered.filter((g) => g.id === filters.id);
      if (filters.season_type !== undefined) {
        filtered = filtered.filter((g) => g.season_type === filters.season_type);
      }
      return filtered;
    };

    return {
      select: (columns: string) => {
        // `/games/:id/broadcasts` uses select('id').eq().maybeSingle()
        if (columns === 'id') {
          return {
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                const match = rows.find((g) => g.id === id);
                return { data: match ? { id: match.id } : null, error: null };
              },
            }),
          };
        }

        const filters: { week?: number; status?: string; season_type?: string } = {};
        const builder = {
          eq: (col: string, value: string | number) => {
            if (col === 'week') filters.week = Number(value);
            if (col === 'status') filters.status = String(value);
            if (col === 'season_type') filters.season_type = String(value);
            return builder;
          },
          order: () => {
            const data = run(filters)
              .slice()
              .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
            // Thenable for week-slate list queries; limit/maybeSingle for opener derivation.
            return {
              then: (
                onfulfilled?: (value: { data: GameRow[]; error: null }) => unknown,
                onrejected?: (reason: unknown) => unknown,
              ) => Promise.resolve({ data, error: null }).then(onfulfilled, onrejected),
              limit: () => ({
                maybeSingle: async () => ({
                  data: data[0] ? { scheduled_start: data[0].scheduled_start } : null,
                  error: null,
                }),
              }),
            };
          },
        };
        return builder;
      },
    };
  }
}

const DEFAULT_TEAMS: TeamRow[] = [
  {
    id: TEAM_HOME,
    abbreviation: 'KC',
    name: 'Chiefs',
    primary_color: '#E31837',
    secondary_color: '#FFB612',
  },
  {
    id: TEAM_AWAY,
    abbreviation: 'LV',
    name: 'Raiders',
    primary_color: '#000000',
    secondary_color: '#A5ACAF',
  },
  {
    id: TEAM_HOME_2,
    abbreviation: 'BUF',
    name: 'Bills',
    primary_color: '#00338D',
    secondary_color: '#C60C30',
  },
  {
    id: TEAM_AWAY_2,
    abbreviation: 'MIA',
    name: 'Dolphins',
    primary_color: '#008E97',
    secondary_color: '#FC4C02',
  },
];

interface FixtureOptions {
  games?: GameRow[];
  teams?: TeamRow[];
  broadcasts?: BroadcastRow[];
  presence?: Map<string, PresenceRow[]>;
  gameStateStore?: InMemoryGameStateStore;
}

async function buildTestApp(options: FixtureOptions = {}) {
  const fake = new FakeSupabase({
    games: options.games ?? [],
    teams: options.teams ?? DEFAULT_TEAMS,
    broadcasts: options.broadcasts ?? [],
    presence: options.presence ?? new Map(),
  });
  const gameStateStore = options.gameStateStore ?? new InMemoryGameStateStore();
  const lineupCache = new InMemoryLineupCache();
  // Week slate scopes by current NFL phase — seed a regular-season state so tests don't hit Sleeper.
  await lineupCache.setNflState(
    { season: '2026', week: 1, seasonType: 'regular', seasonStartDate: null },
    300,
  );

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
    supabase: fake as unknown as SupabaseServiceClient,
    lineupCache,
    gameStateStore,
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(gamesRoutes);
  return { fastify, fake, gameStateStore };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_1,
    homeTeamId: TEAM_HOME,
    awayTeamId: TEAM_AWAY,
    possessionTeamId: TEAM_HOME,
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 7,
    quarter: 2,
    timeRemainingSec: 500,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

describe('GET /games/:id/broadcasts', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({ games: [{ id: GAME_1, week: 1, status: 'scheduled', scheduled_start: '2026-09-10T17:00:00Z', home_team_id: TEAM_HOME, away_team_id: TEAM_AWAY }] });
    const response = await app.fastify.inject({ method: 'GET', url: `/games/${GAME_1}/broadcasts` });
    expect(response.statusCode).toBe(401);
  });

  it('404s for a game that does not exist', async () => {
    app = await buildTestApp({ games: [] });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('game_not_found');
  });

  it('returns an empty broadcast list for a game with no broadcasts', async () => {
    app = await buildTestApp({
      games: [{ id: GAME_1, week: 1, status: 'scheduled', scheduled_start: '2026-09-10T17:00:00Z', home_team_id: TEAM_HOME, away_team_id: TEAM_AWAY }],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: `/games/${GAME_1}/broadcasts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ game_id: GAME_1, broadcasts: [] });
  });

  it('ranks broadcasts by eligibility then lag, marking exactly one preferred', async () => {
    app = await buildTestApp({
      games: [{ id: GAME_1, week: 1, status: 'scheduled', scheduled_start: '2026-09-10T17:00:00Z', home_team_id: TEAM_HOME, away_team_id: TEAM_AWAY }],
      broadcasts: [
        { game_id: GAME_1, service: 'sunday_ticket', deep_link_url: 'https://st/g1', requires_subscription: true },
        { game_id: GAME_1, service: 'fox', deep_link_url: 'https://fox/g1', requires_subscription: false },
      ],
      presence: new Map([['user-1', [{ service: 'sunday_ticket', has_subscription: true }]]]),
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
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
      games: [{ id: GAME_1, week: 1, status: 'scheduled', scheduled_start: '2026-09-10T17:00:00Z', home_team_id: TEAM_HOME, away_team_id: TEAM_AWAY }],
      broadcasts: [
        { game_id: GAME_1, service: 'sunday_ticket', deep_link_url: 'https://st/g1', requires_subscription: true },
      ],
      presence: new Map([['user-1', [{ service: 'sunday_ticket', has_subscription: false }]]]),
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
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

describe('GET /games?week=', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'GET', url: '/games?week=1' });
    expect(response.statusCode).toBe(401);
  });

  it('requires the week query param', async () => {
    app = await buildTestApp();
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns an empty slate for a week with no games', async () => {
    app = await buildTestApp({ games: [] });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games?week=0',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ week: 0, games: [] });
  });

  it('returns the week slate with team fields and rankBroadcasts-ranked broadcasts', async () => {
    app = await buildTestApp({
      games: [
        {
          id: GAME_2,
          week: 1,
          season_type: 'regular',
          status: 'scheduled',
          scheduled_start: '2026-09-14T17:00:00Z',
          home_team_id: TEAM_HOME_2,
          away_team_id: TEAM_AWAY_2,
        },
        {
          id: GAME_1,
          week: 1,
          season_type: 'regular',
          status: 'scheduled',
          scheduled_start: '2026-09-10T20:20:00Z',
          home_team_id: TEAM_HOME,
          away_team_id: TEAM_AWAY,
        },
      ],
      broadcasts: [
        { game_id: GAME_1, service: 'sunday_ticket', deep_link_url: 'https://st/g1', requires_subscription: true },
        { game_id: GAME_1, service: 'fox', deep_link_url: 'https://fox/g1', requires_subscription: false },
        { game_id: GAME_2, service: 'cbs', deep_link_url: 'https://cbs/g2', requires_subscription: false },
      ],
      presence: new Map([['user-1', [{ service: 'sunday_ticket', has_subscription: true }]]]),
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games?week=1',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.week).toBe(1);
    // Ordered by scheduled_start ascending
    expect(body.games.map((g: { game_id: string }) => g.game_id)).toEqual([GAME_1, GAME_2]);
    expect(body.games[0]).toMatchObject({
      game_id: GAME_1,
      status: 'scheduled',
      scheduled_start: '2026-09-10T20:20:00Z',
      home_team: 'KC',
      away_team: 'LV',
      home_team_name: 'Chiefs',
      away_team_name: 'Raiders',
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
    expect(body.games[1].broadcasts).toEqual([
      {
        service: 'cbs',
        deep_link_url: 'https://cbs/g2',
        requires_subscription: false,
        user_has_subscription: false,
        typical_lag_seconds: 8,
        preferred: true,
      },
    ]);
    // ONE presence load for the whole slate — not one per game.
    expect(app.fake.presenceReads).toBe(1);
  });
});

describe('GET /games/live', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp();
    const response = await app.fastify.inject({ method: 'GET', url: '/games/live' });
    expect(response.statusCode).toBe(401);
  });

  it('returns live games hydrated from Redis with possession_team', async () => {
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.setGameState(GAME_1, makeGameState());
    app = await buildTestApp({
      games: [
        {
          id: GAME_1,
          week: 1,
          status: 'in_progress',
          scheduled_start: '2026-09-10T17:00:00Z',
          home_team_id: TEAM_HOME,
          away_team_id: TEAM_AWAY,
        },
      ],
      gameStateStore,
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games/live',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      games: [
        {
          game_id: GAME_1,
          status: 'in_progress',
          scheduled_start: '2026-09-10T17:00:00Z',
          home_team: 'KC',
          away_team: 'LV',
          home_team_name: 'Chiefs',
          away_team_name: 'Raiders',
          home_team_primary_color: '#E31837',
          home_team_secondary_color: '#FFB612',
          away_team_primary_color: '#000000',
          away_team_secondary_color: '#A5ACAF',
          score: { home: 14, away: 7 },
          quarter: 2,
          time_remaining_sec: 500,
          possession_team: 'KC',
        },
      ],
    });
  });

  it('OMITS in_progress games that have no Redis live-state (does not degrade to zeros)', async () => {
    // GAME_1 has Redis state; GAME_2 is in_progress in DB but has no Redis state → omit.
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.setGameState(GAME_1, makeGameState({ gameId: GAME_1 }));
    app = await buildTestApp({
      games: [
        {
          id: GAME_1,
          week: 1,
          status: 'in_progress',
          scheduled_start: '2026-09-10T17:00:00Z',
          home_team_id: TEAM_HOME,
          away_team_id: TEAM_AWAY,
        },
        {
          id: GAME_2,
          week: 1,
          status: 'in_progress',
          scheduled_start: '2026-09-10T20:20:00Z',
          home_team_id: TEAM_HOME_2,
          away_team_id: TEAM_AWAY_2,
        },
      ],
      gameStateStore,
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games/live',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.games).toHaveLength(1);
    expect(body.games[0].game_id).toBe(GAME_1);
    expect(body.games[0].score).toEqual({ home: 14, away: 7 });
    // Explicitly: the omitted game must not appear as a zeroed degrade.
    expect(body.games.find((g: { game_id: string }) => g.game_id === GAME_2)).toBeUndefined();
    expect(
      body.games.some(
        (g: { score: { home: number; away: number }; quarter: number }) =>
          g.score.home === 0 && g.score.away === 0 && g.quarter === 0,
      ),
    ).toBe(false);
  });

  it('does not include scheduled (non-live) games', async () => {
    const gameStateStore = new InMemoryGameStateStore();
    await gameStateStore.setGameState(GAME_1, makeGameState());
    app = await buildTestApp({
      games: [
        {
          id: GAME_1,
          week: 1,
          status: 'scheduled',
          scheduled_start: '2026-09-10T17:00:00Z',
          home_team_id: TEAM_HOME,
          away_team_id: TEAM_AWAY,
        },
      ],
      gameStateStore,
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/games/live',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ games: [] });
  });
});
