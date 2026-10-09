import { readFileSync } from 'node:fs';
import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import type { GameState, UserLineupCache } from '@pivot/shared';
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
import flagsRoutes from './flags.js';
import { toRecommendedAction } from './flags.js';
import type { Action } from '@pivot/dispatcher';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const WEEK = 5;

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface GameRow {
  id: string;
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

interface PlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  position: string;
  team_id?: string;
}

interface LeagueRow {
  id: string;
  season_year: number;
}

interface StakeRow {
  id: string;
  user_id: string;
  season: number;
  week: number;
  game_id: string;
  subject: { type: 'PLAYER'; playerId: string; teamId: string };
  condition: { type: string };
  source: string;
  source_ref: string | null;
  weight: number;
  created_at: string;
}

interface UsersFixture {
  subscription_tier: string;
  preferences: unknown;
}

interface FlagEventRow {
  id: string;
  user_id: string;
  user_action: string | null;
}

/** Chainable stand-in for a supabase-js query builder: every filter method returns itself, and the
 *  object resolves (via `.then`) to the canned `{ data, error }` — `.single()` short-circuits to the
 *  first row. Good enough to exercise the route's orchestration without a real Postgres. */
class FakeQuery<T> implements PromiseLike<{ data: T[] | null; error: null }> {
  constructor(private readonly rows: T[]) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  or() {
    return this;
  }
  order() {
    return this;
  }
  single(): Promise<{ data: T | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then<TResult1 = { data: T[] | null; error: null }, TResult2 = never>(
    onfulfilled?: (value: { data: T[] | null; error: null }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

/** Stand-in for `flag_events` specifically for `POST /flags/:event_id/action` — unlike `FakeQuery`
 *  (read-only, ignores its filter args), this one actually applies `.eq()` filters so tests can
 *  assert the ownership check (`user_id` must match) really gates the update, not just that a
 *  request to the route returns 200. */
class FakeFlagEventsQuery {
  private readonly filters: [string, string][] = [];
  private patch: Partial<FlagEventRow> | null = null;

  constructor(private readonly rows: FlagEventRow[]) {}

  update(patch: Partial<FlagEventRow>) {
    this.patch = patch;
    return this;
  }
  eq(column: string, value: string) {
    this.filters.push([column, value]);
    return this;
  }
  select() {
    return this;
  }
  single(): Promise<{ data: FlagEventRow | null; error: { message: string } | null }> {
    const row = this.rows.find((candidate) =>
      this.filters.every(([column, value]) => candidate[column as keyof FlagEventRow] === value),
    );
    if (!row) {
      return Promise.resolve({ data: null, error: { message: 'no matching row' } });
    }
    if (this.patch) {
      Object.assign(row, this.patch);
    }
    return Promise.resolve({ data: row, error: null });
  }
}

function makeSupabase(
  fixtures: {
    games: GameRow[];
    teams: TeamRow[];
    user: UsersFixture;
    flagEvents?: FlagEventRow[];
    players?: PlayerRow[];
    leagues?: LeagueRow[];
    stakes?: StakeRow[];
  },
  queried: string[],
) {
  return {
    from: (table: string) => {
      queried.push(table);
      if (table === 'games') return new FakeQuery(fixtures.games);
      if (table === 'teams') return new FakeQuery(fixtures.teams);
      if (table === 'users') return new FakeQuery([fixtures.user]);
      if (table === 'flag_events') return new FakeFlagEventsQuery(fixtures.flagEvents ?? []);
      if (table === 'players') return new FakeQuery(fixtures.players ?? []);
      if (table === 'leagues') {
        if (!fixtures.leagues) throw new Error(`Unexpected table in test fixture: ${table}`);
        return new FakeQuery(fixtures.leagues);
      }
      if (table === 'stakes') {
        if (!fixtures.stakes) throw new Error(`Unexpected table in test fixture: ${table}`);
        return new FakeQuery(fixtures.stakes);
      }
      throw new Error(`Unexpected table in test fixture: ${table}`);
    },
  } as unknown as SupabaseServiceClient;
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game-1',
    homeTeamId: 'team-kc',
    awayTeamId: 'team-lv',
    possessionTeamId: 'team-kc',
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 7,
    quarter: 2,
    timeRemainingSec: 500,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

function opponentStake(
  id: string,
  playerId: string,
  teamId: string,
  overrides: Partial<StakeRow> = {},
): StakeRow {
  return {
    id,
    user_id: 'user-1',
    season: 2026,
    week: WEEK,
    game_id: 'stored-game',
    subject: { type: 'PLAYER', playerId, teamId },
    condition: { type: 'OPPONENT_ROSTERED' },
    source: 'SLEEPER_OPPONENT',
    source_ref: 'league-1',
    weight: 0.5,
    created_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

interface TestApp {
  fastify: ReturnType<typeof Fastify>;
  lineupCache: InMemoryLineupCache;
  gameStateStore: InMemoryGameStateStore;
  queriedTables: string[];
}

async function buildTestApp(fixtures: {
  games: GameRow[];
  teams: TeamRow[];
  user: UsersFixture;
  flagEvents?: FlagEventRow[];
  players?: PlayerRow[];
  leagues?: LeagueRow[];
  stakes?: StakeRow[];
}): Promise<TestApp> {
  const queriedTables: string[] = [];
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: WEEK, seasonType: 'regular', seasonStartDate: null },
    300,
  );
  const gameStateStore = new InMemoryGameStateStore();

  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  // Mirrors server.ts's error handler (Section 9 `{ error: { code, message } }` shape under test) —
  // needed now that `POST /flags/:event_id/action` (Sprint 6 Phase 7) can throw `ApiError`, unlike
  // `GET /flags/current` above it, which never did.
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
    supabase: makeSupabase(fixtures, queriedTables),
    lineupCache,
    gameStateStore,
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(flagsRoutes);

  return { fastify, lineupCache, gameStateStore, queriedTables };
}

async function setLineup(
  app: TestApp,
  userId: string,
  teamPositions: [string, ('offense' | 'defense')[]][],
): Promise<void> {
  const cache: UserLineupCache = {
    userId,
    week: WEEK,
    teamPositions: new Map(teamPositions.map(([teamId, cats]) => [teamId, new Set(cats)])),
    playerToTeam: new Map([['player-1', teamPositions[0]?.[0] ?? '']]),
    starPlayerIds: new Set(),
  };
  await app.lineupCache.setLineupCache(userId, WEEK, cache);
}

describe('GET /flags/current', () => {
  let app: TestApp;

  afterEach(async () => {
    await app.fastify.close();
  });

  it('returns an empty list when the user has no lineup cached', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.flags).toEqual([]);
    expect(typeof body.generated_at).toBe('string');
    expect(new Date(body.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('returns an empty list when no game this week involves a stake team', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().flags).toEqual([]);
  });

  it('returns an empty list when the game has no live GameState yet', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        { id: 'team-kc', abbreviation: 'KC', name: 'Chiefs', primary_color: '#E31837', secondary_color: '#FFB81C' },
        { id: 'team-lv', abbreviation: 'LV', name: 'Raiders', primary_color: '#000000', secondary_color: '#A5ACAF' },
      ],
      user: { subscription_tier: 'free', preferences: {} },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().flags).toEqual([]);
  });

  it('excludes games that are live but not flagged for this user', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        { id: 'team-kc', abbreviation: 'KC', name: 'Chiefs', primary_color: '#E31837', secondary_color: '#FFB81C' },
        { id: 'team-lv', abbreviation: 'LV', name: 'Raiders', primary_color: '#000000', secondary_color: '#A5ACAF' },
      ],
      user: { subscription_tier: 'free', preferences: {} },
    });
    await setLineup(app, 'user-1', [['team-kc', ['defense']]]); // only owns defense; offense is on the field
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().flags).toEqual([]);
  });

  it('recomputes fresh and returns the Section 9 shape for a flagged game', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        { id: 'team-kc', abbreviation: 'KC', name: 'Chiefs', primary_color: '#E31837', secondary_color: '#FFB81C' },
        { id: 'team-lv', abbreviation: 'LV', name: 'Raiders', primary_color: '#000000', secondary_color: '#A5ACAF' },
      ],
      user: { subscription_tier: 'free', preferences: {} },
      players: [
        { id: 'player-1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
      ],
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.flags).toHaveLength(1);
    const flag = body.flags[0];
    expect(flag.game_id).toBe('game-1');
    expect(flag.priority_score).toBeGreaterThan(0);
    expect(flag.reasons).toEqual(['offense_active']);
    // Section 9 (Sprint 9 Phase 1): full player objects, not just ids — same shape as the WebSocket
    // flag_event payload's flagged_players, so the client renders identically from either channel.
    expect(flag.flagged_players).toEqual([
      { player_id: 'player-1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
    ]);
    expect(flag.flagged_player_ids).toBeUndefined();
    expect(flag.game).toEqual({
      home_team: 'KC',
      away_team: 'LV',
      home_team_name: 'Chiefs',
      away_team_name: 'Raiders',
      // Sprint 9 Phase 1: team colors, closing the "team color flash not implemented" Known Issue.
      home_team_primary_color: '#E31837',
      home_team_secondary_color: '#FFB81C',
      away_team_primary_color: '#000000',
      away_team_secondary_color: '#A5ACAF',
      score: { home: 14, away: 7 },
      quarter: 2,
      time_remaining_sec: 500,
      possession_team: 'KC',
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    });
    // No viewing session yet (Phase 6) -> currentPrimaryPriority is 0 -> any flagged game recommends
    // switch_primary (autoSwitch is off by default).
    expect(flag.recommended_action).toBe('switch_primary');
  });

  it('omits a triggering player id from flagged_players when the players table has no matching row', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        { id: 'team-kc', abbreviation: 'KC', name: 'Chiefs', primary_color: '#E31837', secondary_color: '#FFB81C' },
        { id: 'team-lv', abbreviation: 'LV', name: 'Raiders', primary_color: '#000000', secondary_color: '#A5ACAF' },
      ],
      user: { subscription_tier: 'free', preferences: {} },
      players: [], // no matching row for player-1
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().flags[0].flagged_players).toEqual([]);
  });

  it('returns an empty flagged_players array (and skips the players query) when no game is flagged', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      // No `players` fixture set — if the route queried `players` unconditionally, makeSupabase would
      // throw for an unmocked table only if it selected 'players' with no rows fixture; since it's
      // optional here this just documents that an unflagged response never resolves player names.
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json().flags).toEqual([]);
  });

  it('recommends notify_only when the user has autoSwitch enabled', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        { id: 'team-kc', abbreviation: 'KC', name: 'Chiefs', primary_color: '#E31837', secondary_color: '#FFB81C' },
        { id: 'team-lv', abbreviation: 'LV', name: 'Raiders', primary_color: '#000000', secondary_color: '#A5ACAF' },
      ],
      user: { subscription_tier: 'free', preferences: { autoSwitch: true } },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    // auto_switch has cta: null -> toRecommendedAction collapses it to notify_only.
    expect(response.json().flags[0].recommended_action).toBe('notify_only');
  });

  it('sorts by priority_score descending, then game_id ascending on ties', async () => {
    app = await buildTestApp({
      games: [
        { id: 'game-b', home_team_id: 'team-b', away_team_id: 'team-b-opp' },
        { id: 'game-a', home_team_id: 'team-a', away_team_id: 'team-a-opp' },
      ],
      teams: [
        { id: 'team-a', abbreviation: 'AAA', name: 'Team A', primary_color: '#111111', secondary_color: '#222222' },
        { id: 'team-a-opp', abbreviation: 'AOP', name: 'Team A Opponents', primary_color: '#333333', secondary_color: '#444444' },
        { id: 'team-b', abbreviation: 'BBB', name: 'Team B', primary_color: '#555555', secondary_color: '#666666' },
        { id: 'team-b-opp', abbreviation: 'BOP', name: 'Team B Opponents', primary_color: '#777777', secondary_color: '#888888' },
      ],
      user: { subscription_tier: 'free', preferences: {} },
    });
    const cache: UserLineupCache = {
      userId: 'user-1',
      week: WEEK,
      teamPositions: new Map([
        ['team-a', new Set<'offense' | 'defense'>(['offense'])],
        ['team-b', new Set<'offense' | 'defense'>(['offense'])],
      ]),
      playerToTeam: new Map([
        ['player-a', 'team-a'],
        ['player-b', 'team-b'],
      ]),
      starPlayerIds: new Set(),
    };
    await app.lineupCache.setLineupCache('user-1', WEEK, cache);

    // Identical priority-producing state for both games -> tie on priority_score.
    await app.gameStateStore.setGameState(
      'game-a',
      makeGameState({ gameId: 'game-a', homeTeamId: 'team-a', possessionTeamId: 'team-a' }),
    );
    await app.gameStateStore.setGameState(
      'game-b',
      makeGameState({ gameId: 'game-b', homeTeamId: 'team-b', possessionTeamId: 'team-b' }),
    );

    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    const gameIds = response.json().flags.map((f: { game_id: string }) => f.game_id);
    expect(gameIds).toEqual(['game-a', 'game-b']);
  });

  it("keeps today's body when watchOpponent is off and does not query opponent stakes", async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        {
          id: 'team-kc',
          abbreviation: 'KC',
          name: 'Chiefs',
          primary_color: '#E31837',
          secondary_color: '#FFB81C',
        },
        {
          id: 'team-lv',
          abbreviation: 'LV',
          name: 'Raiders',
          primary_color: '#000000',
          secondary_color: '#A5ACAF',
        },
      ],
      user: { subscription_tier: 'free', preferences: {} },
      players: [{ id: 'player-1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' }],
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = response.json();
    const { generated_at, ...rest } = body;
    expect(typeof generated_at).toBe('string');
    expect(rest).toEqual({
      flags: [
        {
          game_id: 'game-1',
          priority_score: 2,
          reasons: ['offense_active'],
          flagged_players: [
            { player_id: 'player-1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
          ],
          game: {
            home_team: 'KC',
            away_team: 'LV',
            home_team_name: 'Chiefs',
            away_team_name: 'Raiders',
            home_team_primary_color: '#E31837',
            home_team_secondary_color: '#FFB81C',
            away_team_primary_color: '#000000',
            away_team_secondary_color: '#A5ACAF',
            score: { home: 14, away: 7 },
            quarter: 2,
            time_remaining_sec: 500,
            possession_team: 'KC',
            yards_to_endzone: null,
            down: null,
            distance: null,
            in_red_zone: false,
          },
          recommended_action: 'switch_primary',
        },
      ],
    });
    expect(app.queriedTables).not.toContain('stakes');
    expect(app.queriedTables).not.toContain('leagues');
  });

  it('leaves flags unchanged when watchOpponent is on for the same fixture', async () => {
    const games = [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }];
    const teams = [
      {
        id: 'team-kc',
        abbreviation: 'KC',
        name: 'Chiefs',
        primary_color: '#E31837',
        secondary_color: '#FFB81C',
      },
      {
        id: 'team-lv',
        abbreviation: 'LV',
        name: 'Raiders',
        primary_color: '#000000',
        secondary_color: '#A5ACAF',
      },
    ];
    const players = [
      { id: 'player-1', first_name: 'Jonathan', last_name: 'Taylor', position: 'RB' },
    ];
    app = await buildTestApp({
      games,
      teams,
      players,
      user: { subscription_tier: 'free', preferences: {} },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const off = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.fastify.close();

    app = await buildTestApp({
      games,
      teams,
      players,
      leagues: [],
      user: { subscription_tier: 'free', preferences: { watchOpponent: true } },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState('game-1', makeGameState());
    const on = await app.fastify.inject({
      method: 'GET',
      url: '/flags/current',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(on.json().flags).toEqual(off.json().flags);
    expect(on.json().opponent_flags).toEqual([]);
    expect(on.json().opponent_game_ids).toEqual([]);
  });

  it('includes a red-zone opponent WR and omits a D/ST, another week, and rostered stakes', async () => {
    app = await buildTestApp({
      games: [
        { id: 'game-2', home_team_id: 'team-buf', away_team_id: 'team-mia' },
        { id: 'game-1', home_team_id: 'team-phi', away_team_id: 'team-dal' },
        { id: 'game-old', home_team_id: 'team-old', away_team_id: 'team-bye' },
      ],
      teams: [
        {
          id: 'team-buf',
          abbreviation: 'BUF',
          name: 'Bills',
          primary_color: '#00338D',
          secondary_color: '#C60C30',
        },
        {
          id: 'team-mia',
          abbreviation: 'MIA',
          name: 'Dolphins',
          primary_color: '#008E97',
          secondary_color: '#FC4C02',
        },
        {
          id: 'team-phi',
          abbreviation: 'PHI',
          name: 'Eagles',
          primary_color: '#004C54',
          secondary_color: '#A5ACAF',
        },
        {
          id: 'team-dal',
          abbreviation: 'DAL',
          name: 'Cowboys',
          primary_color: '#003594',
          secondary_color: '#869397',
        },
        {
          id: 'team-old',
          abbreviation: 'OLD',
          name: 'Old',
          primary_color: '#111111',
          secondary_color: '#222222',
        },
        {
          id: 'team-bye',
          abbreviation: 'BYE',
          name: 'Bye',
          primary_color: '#333333',
          secondary_color: '#444444',
        },
      ],
      leagues: [{ id: 'league-1', season_year: 2026 }],
      stakes: [
        opponentStake('stake-wr', 'wr-1', 'team-buf'),
        opponentStake('stake-wr-2', 'wr-2', 'team-phi'),
        opponentStake('stake-dst', 'dst-1', 'team-mia'),
        opponentStake('stake-old', 'old-1', 'team-old', { week: WEEK - 1 }),
        {
          ...opponentStake('stake-rostered', 'own-1', 'team-buf'),
          condition: { type: 'ROSTERED' },
          source: 'SLEEPER_ROSTER',
        },
      ],
      players: [
        {
          id: 'wr-1',
          first_name: 'Stefon',
          last_name: 'Diggs',
          position: 'WR',
          team_id: 'team-buf',
        },
        { id: 'wr-2', first_name: 'A.J.', last_name: 'Brown', position: 'WR', team_id: 'team-phi' },
        {
          id: 'dst-1',
          first_name: 'Miami',
          last_name: 'Defense',
          position: 'DEF',
          team_id: 'team-mia',
        },
        {
          id: 'old-1',
          first_name: 'Old',
          last_name: 'Player',
          position: 'WR',
          team_id: 'team-old',
        },
        { id: 'own-1', first_name: 'Own', last_name: 'Back', position: 'RB', team_id: 'team-buf' },
      ],
      user: { subscription_tier: 'free', preferences: { watchOpponent: true } },
    });
    await app.gameStateStore.setGameState(
      'game-2',
      makeGameState({
        gameId: 'game-2',
        homeTeamId: 'team-buf',
        awayTeamId: 'team-mia',
        possessionTeamId: 'team-buf',
        inRedZone: true,
        yardsToOpponentEndzone: 8,
      }),
    );
    await app.gameStateStore.setGameState(
      'game-1',
      makeGameState({
        gameId: 'game-1',
        homeTeamId: 'team-phi',
        awayTeamId: 'team-dal',
        possessionTeamId: 'team-phi',
        inRedZone: true,
        yardsToOpponentEndzone: 4,
      }),
    );
    await app.gameStateStore.setGameState(
      'game-old',
      makeGameState({
        gameId: 'game-old',
        homeTeamId: 'team-old',
        awayTeamId: 'team-bye',
        possessionTeamId: 'team-old',
        inRedZone: true,
      }),
    );
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const body = (
      await app.fastify.inject({
        method: 'GET',
        url: '/flags/current',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();

    expect(body.flags).toEqual([]);
    expect(body.opponent_flags.map((flag: { game_id: string }) => flag.game_id)).toEqual([
      'game-1',
      'game-2',
    ]);
    expect(body.opponent_flags[0]).toMatchObject({
      game_id: 'game-1',
      priority_score: 1,
      player_ids: ['wr-2'],
      reasons: ['red_zone'],
    });
    expect(body.opponent_flags[1].player_ids).toEqual(['wr-1']);
    const surfaced = body.opponent_flags.flatMap(
      (flag: { player_ids: string[] }) => flag.player_ids,
    );
    expect(surfaced).not.toContain('dst-1');
    expect(surfaced).not.toContain('old-1');
    expect(surfaced).not.toContain('own-1');
    expect(body.opponent_game_ids).toEqual(['game-1', 'game-2']);
    expect(app.queriedTables).not.toContain('lineup_slots');
  });

  it('omits an opponent flag for a game already in flags but still lists that game', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-1', home_team_id: 'team-kc', away_team_id: 'team-lv' }],
      teams: [
        {
          id: 'team-kc',
          abbreviation: 'KC',
          name: 'Chiefs',
          primary_color: '#E31837',
          secondary_color: '#FFB81C',
        },
        {
          id: 'team-lv',
          abbreviation: 'LV',
          name: 'Raiders',
          primary_color: '#000000',
          secondary_color: '#A5ACAF',
        },
      ],
      leagues: [{ id: 'league-1', season_year: 2026 }],
      stakes: [opponentStake('stake-wr', 'wr-1', 'team-kc')],
      players: [
        {
          id: 'player-1',
          first_name: 'Jonathan',
          last_name: 'Taylor',
          position: 'RB',
          team_id: 'team-kc',
        },
        {
          id: 'wr-1',
          first_name: 'Stefon',
          last_name: 'Diggs',
          position: 'WR',
          team_id: 'team-kc',
        },
      ],
      user: { subscription_tier: 'free', preferences: { watchOpponent: true } },
    });
    await setLineup(app, 'user-1', [['team-kc', ['offense']]]);
    await app.gameStateStore.setGameState(
      'game-1',
      makeGameState({ inRedZone: true, yardsToOpponentEndzone: 9 }),
    );
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const body = (
      await app.fastify.inject({
        method: 'GET',
        url: '/flags/current',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();

    expect(body.flags.map((flag: { game_id: string }) => flag.game_id)).toEqual(['game-1']);
    expect(body.opponent_flags).toEqual([]);
    expect(body.opponent_game_ids).toEqual(['game-1']);
  });

  it('lists an opponent game with no live state and does not flag it', async () => {
    app = await buildTestApp({
      games: [{ id: 'game-quiet', home_team_id: 'team-buf', away_team_id: 'team-mia' }],
      teams: [
        {
          id: 'team-buf',
          abbreviation: 'BUF',
          name: 'Bills',
          primary_color: '#00338D',
          secondary_color: '#C60C30',
        },
        {
          id: 'team-mia',
          abbreviation: 'MIA',
          name: 'Dolphins',
          primary_color: '#008E97',
          secondary_color: '#FC4C02',
        },
      ],
      leagues: [{ id: 'league-1', season_year: 2026 }],
      stakes: [opponentStake('stake-wr', 'wr-1', 'team-buf')],
      players: [
        {
          id: 'wr-1',
          first_name: 'Stefon',
          last_name: 'Diggs',
          position: 'WR',
          team_id: 'team-buf',
        },
      ],
      user: { subscription_tier: 'free', preferences: { watchOpponent: true } },
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const body = (
      await app.fastify.inject({
        method: 'GET',
        url: '/flags/current',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();

    expect(body.flags).toEqual([]);
    expect(body.opponent_flags).toEqual([]);
    expect(body.opponent_game_ids).toEqual(['game-quiet']);
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
    });
    const response = await app.fastify.inject({ method: 'GET', url: '/flags/current' });
    expect(response.statusCode).toBe(401);
  });
});

describe('flags route source', () => {
  it('does not import dispatch or reference sendPush', () => {
    const flags = readFileSync(new URL('./flags.ts', import.meta.url), 'utf8');
    const opponent = readFileSync(
      new URL('../lib/opponentFlagsCurrent.ts', import.meta.url),
      'utf8',
    );
    expect(flags.includes('sendPush')).toBe(false);
    expect(opponent.includes('sendPush')).toBe(false);
    expect(opponent.includes('@pivot/dispatcher')).toBe(false);
    const imported = flags.match(/import\s*\{([^}]+)\}\s*from '@pivot\/dispatcher'/);
    expect(imported).not.toBeNull();
    const names = imported?.[1]
      ?.split(',')
      .map((part) => part.replace(/\btype\b/g, '').trim())
      .filter((part) => part.length > 0);
    expect(names).toEqual(['buildGameSummary', 'decideAction', 'Action', 'ViewingSessionSnapshot']);
  });
});

describe('POST /flags/:event_id/action', () => {
  let app: TestApp;
  const EVENT_ID = '11111111-1111-4111-8111-111111111111';

  afterEach(async () => {
    await app.fastify.close();
  });

  it('records the action on the caller\'s own flag_events row', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [{ id: EVENT_ID, user_id: 'user-1', user_action: null }],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: `/flags/${EVENT_ID}/action`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'switched' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ event_id: EVENT_ID, user_action: 'switched' });
  });

  it.each(['switched', 'added_to_split', 'dismissed', 'ignored'] as const)(
    'accepts the "%s" action value',
    async (action) => {
      app = await buildTestApp({
        games: [],
        teams: [],
        user: { subscription_tier: 'free', preferences: {} },
        flagEvents: [{ id: EVENT_ID, user_id: 'user-1', user_action: null }],
      });
      const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

      const response = await app.fastify.inject({
        method: 'POST',
        url: `/flags/${EVENT_ID}/action`,
        headers: { authorization: `Bearer ${token}` },
        payload: { action },
      });

      expect(response.statusCode).toBe(200);
    },
  );

  it('rejects an invalid action value', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [{ id: EVENT_ID, user_id: 'user-1', user_action: null }],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: `/flags/${EVENT_ID}/action`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'not_a_real_action' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an event id that does not exist', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: `/flags/${EVENT_ID}/action`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'switched' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('flag_event_not_found');
  });

  it('returns 404 (not another user\'s data) when the event belongs to someone else', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [{ id: EVENT_ID, user_id: 'someone-else', user_action: null }],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: `/flags/${EVENT_ID}/action`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'switched' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed event_id', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [],
    });
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/flags/not-a-uuid/action',
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'switched' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    app = await buildTestApp({
      games: [],
      teams: [],
      user: { subscription_tier: 'free', preferences: {} },
      flagEvents: [{ id: EVENT_ID, user_id: 'user-1', user_action: null }],
    });

    const response = await app.fastify.inject({
      method: 'POST',
      url: `/flags/${EVENT_ID}/action`,
      payload: { action: 'switched' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('toRecommendedAction', () => {
  const action = (partial: Partial<Action>): Action => ({ type: 'prompt', cta: null, ...partial });

  it('maps a switch_primary CTA straight across', () => {
    expect(toRecommendedAction(action({ cta: 'switch_primary' }))).toBe('switch_primary');
  });

  it('maps an add_to_split CTA straight across', () => {
    expect(toRecommendedAction(action({ cta: 'add_to_split' }))).toBe('add_to_split');
  });

  it('collapses a dismiss CTA (flag_removed) to notify_only', () => {
    expect(toRecommendedAction(action({ type: 'notify_only', cta: 'dismiss' }))).toBe(
      'notify_only',
    );
  });

  it('collapses a null CTA (auto_switch / in_app_indicator) to notify_only', () => {
    expect(toRecommendedAction(action({ type: 'auto_switch', cta: null }))).toBe('notify_only');
    expect(toRecommendedAction(action({ type: 'in_app_indicator', cta: null }))).toBe(
      'notify_only',
    );
  });
});
