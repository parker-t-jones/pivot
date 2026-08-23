import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
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
import {
  buildPlayerSearchText,
  playerSearchTextMatches,
} from '../lib/playerSearchText.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import playersRoutes from './players.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface FixturePlayer {
  id: string;
  first_name: string;
  last_name: string;
  position: string;
  team_id: string;
  city: string;
  team_name: string;
  abbreviation: string;
  active?: boolean;
}

/**
 * In-memory stand-in for `search_players` — same word-prefix + AND semantics as
 * `lib/playerSearchText.ts` / the SQL migration.
 */
class FakeSupabase {
  constructor(private readonly players: FixturePlayer[]) {}

  async rpc(
    fn: string,
    args: { q: string; filter_position?: string | null },
  ): Promise<{ data: unknown; error: null | { message: string } }> {
    if (fn !== 'search_players') {
      return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
    }

    const matched = this.players
      .filter((p) => p.active !== false)
      .filter((p) => args.filter_position == null || p.position === args.filter_position)
      .filter((p) =>
        playerSearchTextMatches(
          buildPlayerSearchText({
            first_name: p.first_name,
            last_name: p.last_name,
            position: p.position,
            city: p.city,
            name: p.team_name,
            abbreviation: p.abbreviation,
          }),
          args.q,
        ),
      )
      .sort(
        (a, b) =>
          a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
      )
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        team_id: p.team_id,
        team_abbreviation: p.abbreviation,
        team_name: p.team_name,
      }));

    return { data: matched, error: null };
  }
}

const FIXTURES: FixturePlayer[] = [
  {
    id: 'p-montgomery',
    first_name: 'David',
    last_name: 'Montgomery',
    position: 'RB',
    team_id: 't-det',
    city: 'Detroit',
    team_name: 'Lions',
    abbreviation: 'DET',
  },
  {
    id: 'p-moore',
    first_name: 'David',
    last_name: 'Moore',
    position: 'WR',
    team_id: 't-car',
    city: 'Charlotte',
    team_name: 'Panthers',
    abbreviation: 'CAR',
  },
  {
    id: 'p-sills',
    first_name: 'David',
    last_name: 'Sills',
    position: 'WR',
    team_id: 't-tb',
    city: 'Tampa',
    team_name: 'Buccaneers',
    abbreviation: 'TB',
  },
  {
    id: 'p-njoku',
    first_name: 'David',
    last_name: 'Njoku',
    position: 'TE',
    team_id: 't-cle',
    city: 'Cleveland',
    team_name: 'Browns',
    abbreviation: 'CLE',
  },
  {
    id: 'p-goff',
    first_name: 'Jared',
    last_name: 'Goff',
    position: 'QB',
    team_id: 't-det',
    city: 'Detroit',
    team_name: 'Lions',
    abbreviation: 'DET',
  },
  {
    id: 'p-lions-def',
    first_name: '',
    last_name: 'Defense',
    position: 'DEF',
    team_id: 't-det',
    city: 'Detroit',
    team_name: 'Lions',
    abbreviation: 'DET',
  },
  {
    id: 'p-bucs-def',
    first_name: '',
    last_name: 'Defense',
    position: 'DEF',
    team_id: 't-tb',
    city: 'Tampa',
    team_name: 'Buccaneers',
    abbreviation: 'TB',
  },
];

async function buildTestApp(players: FixturePlayer[] = FIXTURES) {
  const fastify = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(apiErrorHandler);

  await fastify.register(authPlugin, {
    jwtSecret: JWT_SECRET,
    supabaseUrl: 'http://127.0.0.1:54321',
  });
  await fastify.register(servicesPlugin, {
    supabase: new FakeSupabase(players) as unknown as SupabaseServiceClient,
    lineupCache: new InMemoryLineupCache(),
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  await fastify.register(playersRoutes);
  return fastify;
}

describe('GET /players/search', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(async () => {
    await app.close();
  });

  async function search(q: string, position?: string) {
    const token = await signToken({ sub: 'user-1', email: 'a@b.com' });
    const query = new URLSearchParams({ q });
    if (position) query.set('position', position);
    return await app.inject({
      method: 'GET',
      url: `/players/search?${query.toString()}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it('matches David (single token)', async () => {
    app = await buildTestApp();
    const response = await search('David');
    expect(response.statusCode).toBe(200);
    const names = (response.json() as { players: { last_name: string }[] }).players.map(
      (p) => p.last_name,
    );
    expect(names).toEqual(['Montgomery', 'Moore', 'Njoku', 'Sills']);
  });

  it('AND tokens: David M includes Montgomery/Moore, excludes Tampa Sills', async () => {
    app = await buildTestApp();
    const response = await search('David M');
    expect(response.statusCode).toBe(200);
    const names = (response.json() as { players: { last_name: string }[] }).players.map(
      (p) => p.last_name,
    );
    expect(names).toContain('Montgomery');
    expect(names).toContain('Moore');
    expect(names).not.toContain('Sills');
    expect(names).not.toContain('Njoku');
  });

  it('finds only the Lions defense by team name (not DET skill players)', async () => {
    app = await buildTestApp();
    const response = await search('Lions');
    expect(response.statusCode).toBe(200);
    const players = (
      response.json() as {
        players: { last_name: string; position: string; team: { abbreviation: string } }[];
      }
    ).players;
    expect(players).toEqual([
      expect.objectContaining({
        last_name: 'Defense',
        position: 'DEF',
        team: expect.objectContaining({ abbreviation: 'DET' }),
      }),
    ]);
  });

  it('finds only the Buccaneers defense by team name (not TB skill players)', async () => {
    app = await buildTestApp();
    const response = await search('Buccaneers');
    expect(response.statusCode).toBe(200);
    const players = (
      response.json() as {
        players: { last_name: string; position: string; team: { abbreviation: string } }[];
      }
    ).players;
    expect(players).toEqual([
      expect.objectContaining({
        last_name: 'Defense',
        position: 'DEF',
        team: expect.objectContaining({ abbreviation: 'TB' }),
      }),
    ]);
  });

  it('finds Lions defense by abbreviation DET without skill players', async () => {
    app = await buildTestApp();
    const response = await search('DET');
    expect(response.statusCode).toBe(200);
    const players = (
      response.json() as { players: { position: string; last_name: string }[] }
    ).players;
    expect(players).toEqual([
      expect.objectContaining({ position: 'DEF', last_name: 'Defense' }),
    ]);
  });

  it('finds Buccaneers defense by city Tampa without skill players', async () => {
    app = await buildTestApp();
    const response = await search('Tampa');
    expect(response.statusCode).toBe(200);
    const players = (
      response.json() as {
        players: { position: string; last_name: string; team: { abbreviation: string } }[];
      }
    ).players;
    expect(players).toEqual([
      expect.objectContaining({
        position: 'DEF',
        last_name: 'Defense',
        team: expect.objectContaining({ abbreviation: 'TB' }),
      }),
    ]);
  });

  it('finds defenses by literal Defense', async () => {
    app = await buildTestApp();
    const response = await search('Defense');
    expect(response.statusCode).toBe(200);
    const players = (response.json() as { players: { position: string }[] }).players;
    expect(players.length).toBeGreaterThan(0);
    expect(players.every((p) => p.position === 'DEF')).toBe(true);
  });

  it('honors position filter', async () => {
    app = await buildTestApp();
    const response = await search('David', 'RB');
    expect(response.statusCode).toBe(200);
    const players = (
      response.json() as { players: { last_name: string; position: string }[] }
    ).players;
    expect(players).toEqual([
      expect.objectContaining({ last_name: 'Montgomery', position: 'RB' }),
    ]);
  });

  it('requires auth', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/players/search?q=David' });
    expect(response.statusCode).toBe(401);
  });
});
