import { InMemoryGameStateStore, InMemoryRealtimeBus } from '@pivot/dispatcher';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryLineupCache } from '../cache/in-memory.js';
import { apiErrorHandler } from '../lib/errors.js';
import { MemSupabase } from '../lib/memSupabase.test-helper.js';
import {
  BARKLEY,
  GAME,
  GAMES,
  PLAYERS,
  TEAMS,
  leg,
} from '../lib/slipImport/fixtures.test-helper.js';
import { InMemoryUsageCounter } from '../lib/slipImport/quota.js';
import { SlipReadError, type SlipImage, type SlipReader } from '../lib/slipImport/reader.js';
import type { SlipRead } from '../lib/slipImport/schema.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import { unreachableNflStateSource } from '../lib/nflStateSource.test-helper.js';
import pickImportRoutes from './pickImport.js';

const JWT_SECRET = 'test-secret-at-least-32-characters-long';
const USER = '2057923d-af10-4bfc-966c-db93341863f2';
const NOW = new Date('2026-10-09T16:00:00.000Z');

/** A tiny PNG header plus a private-looking marker, to prove the image is never logged. */
const PRIVATE_MARKER = 'BALANCE-1234-USERNAME-bettor99';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(PRIVATE_MARKER),
]).toString('base64');

class FakeReader implements SlipReader {
  calls: SlipImage[] = [];
  constructor(public result: SlipRead | Error) {}
  async read(image: SlipImage): Promise<SlipRead> {
    this.calls.push(image);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const RUSH_LEG = leg({
  text: 'Saquon Barkley Over 84.5 Rushing Yards (Account bettor99)',
  market: 'PLAYER_STAT',
  stat: 'RUSH_YDS',
  player: 'Saquon Barkley',
  side: 'OVER',
  line: 84.5,
});
const OTHER_LEG = leg({ text: 'Correct score 24-17', market: 'OTHER' });

async function signToken(sub: string): Promise<string> {
  return await new SignJWT({ sub, email: 'a@b.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function setup(
  options: {
    reader?: FakeReader | null;
    tier?: 'free' | 'pro';
    isDemo?: boolean;
    limits?: { free: number; pro: number };
  } = {},
) {
  const db = new MemSupabase();
  db.rows('games').push(...GAMES.map((g) => ({ ...g })));
  db.rows('teams').push(...TEAMS.map((t) => ({ ...t })));
  db.rows('players').push(...PLAYERS.map((p) => ({ ...p, active: true })));
  db.rows('users').push({
    id: USER,
    subscription_tier: options.tier ?? 'free',
    is_demo: options.isDemo ?? false,
  });
  const lineupCache = new InMemoryLineupCache();
  await lineupCache.setNflState(
    { season: '2026', week: 5, seasonType: 'regular', seasonStartDate: '2026-09-09' },
    600,
  );
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ logger: { level: 'trace', stream } }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(apiErrorHandler);
  await app.register(authPlugin, { jwtSecret: JWT_SECRET, supabaseUrl: 'http://127.0.0.1:54321' });
  await app.register(servicesPlugin, {
    supabase: db as unknown as SupabaseServiceClient,
    lineupCache,
    nflStateSource: unreachableNflStateSource,
    gameStateStore: new InMemoryGameStateStore(),
    realtimeSubscriber: new InMemoryRealtimeBus(),
  });
  const reader =
    options.reader === undefined
      ? new FakeReader({ is_bet_slip: true, bet_count: 1, legs: [RUSH_LEG] })
      : options.reader;
  const clock = { now: NOW };
  const counter = new InMemoryUsageCounter(() => clock.now.getTime());
  await app.register(pickImportRoutes, {
    reader,
    counter,
    limits: options.limits ?? { free: 3, pro: 10 },
  });
  const token = await signToken(USER);
  const post = (payload: unknown, auth = true) =>
    app.inject({
      method: 'POST',
      url: '/picks/import',
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload: payload as Record<string, unknown>,
    });
  return {
    app,
    db,
    reader,
    logs,
    post,
    lineupCache,
    setNow: (next: Date) => {
      clock.now = next;
    },
  };
}

describe('POST /picks/import', () => {
  const apps: { close(): Promise<unknown> }[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  async function harness(options: Parameters<typeof setup>[0] = {}) {
    const h = await setup(options);
    apps.push(h.app);
    return h;
  }

  it('returns mapped legs for review and saves nothing', async () => {
    const h = await harness();
    const response = await h.post({ image: PNG });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      kind: 'single',
      imports_left: 2,
      legs: [
        {
          status: 'ready',
          pick: {
            gameId: GAME,
            playerId: BARKLEY,
            condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 84.5 },
          },
          game: { home_team: 'CHI', away_team: 'PHI' },
          player: { last_name: 'Barkley', team: { abbreviation: 'PHI' } },
        },
      ],
    });
    expect(h.reader?.calls[0]?.mediaType).toBe('image/png');
    expect(h.db.rows('stakes')).toHaveLength(0);
    expect(h.db.rows('pick_slips')).toHaveLength(0);
  });

  it('accepts a data URL and returns flagged legs next to ready ones', async () => {
    const h = await harness({
      reader: new FakeReader({ is_bet_slip: true, bet_count: 1, legs: [RUSH_LEG, OTHER_LEG] }),
    });
    const response = await h.post({ image: `data:image/png;base64,${PNG}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kind).toBe('parlay');
    expect(body.legs.map((l: { status: string }) => l.status)).toEqual(['ready', 'flagged']);
    expect(body.legs[1]).toEqual({
      status: 'flagged',
      text: 'Correct score 24-17',
      reason: 'Pivot can’t track this kind of pick yet.',
    });
  });

  it('never logs the image or what the model read', async () => {
    const h = await harness();
    await h.post({ image: PNG });
    const all = h.logs.join('\n');
    expect(all).toContain('"ready":1');
    expect(all).not.toContain(PNG);
    expect(all).not.toContain(PRIVATE_MARKER);
    expect(all).not.toContain('bettor99');
    expect(all).not.toContain('Barkley');
  });

  it('answers 503 when import is not configured', async () => {
    const h = await harness({ reader: null });
    const response = await h.post({ image: PNG });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('slip_import_unavailable');
  });

  it('requires sign-in', async () => {
    const h = await harness();
    const response = await h.post({ image: PNG }, false);
    expect(response.statusCode).toBe(401);
    expect(h.reader?.calls).toHaveLength(0);
  });

  it('refuses the demo account', async () => {
    const h = await harness({ isDemo: true });
    const response = await h.post({ image: PNG });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('demo_account_fixed');
    expect(h.reader?.calls).toHaveLength(0);
  });

  it('refuses a file that is not an image without calling the model', async () => {
    const h = await harness();
    const pdf = Buffer.from('%PDF-1.7 not an image').toString('base64');
    expect((await h.post({ image: pdf })).statusCode).toBe(415);
    expect((await h.post({ image: 'not base64!' })).statusCode).toBe(400);
    expect(h.reader?.calls).toHaveLength(0);
  });

  it('refuses an image over 5 MB', async () => {
    const h = await harness();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await h.post({ image: big.toString('base64') });
    expect(response.statusCode).toBe(413);
    expect(h.reader?.calls).toHaveLength(0);
  });

  it('keeps the default free allowance at three imports per NFL week', async () => {
    const h = await harness();
    for (let used = 1; used <= 3; used += 1) {
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(200);
      expect(response.json().imports_left).toBe(3 - used);
    }
    const blocked = await h.post({ image: PNG });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.details).toEqual({ limit: 3 });
  });

  it('stops a free user after the weekly limit with friendly copy', async () => {
    const h = await harness({ limits: { free: 2, pro: 10 } });
    expect((await h.post({ image: PNG })).json().imports_left).toBe(1);
    expect((await h.post({ image: PNG })).json().imports_left).toBe(0);
    const blocked = await h.post({ image: PNG });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toEqual({
      code: 'slip_import_limit',
      message:
        'You’ve used this week’s 2 screenshot imports. You can still add picks yourself, imports reset next week, and Pro includes more.',
      details: { limit: 2 },
    });
    expect(h.reader?.calls).toHaveLength(2);
  });

  it('keeps the free counter for the NFL week it started in, even across a UTC midnight', async () => {
    const h = await harness({ limits: { free: 2, pro: 10 } });
    // harness() already seeds the lineup cache with season 2026 / week 5.
    expect((await h.post({ image: PNG })).json().imports_left).toBe(1);
    // Later UTC clock, same NFL week: still charges the same counter.
    h.setNow(new Date('2026-10-10T08:00:00.000Z'));
    expect((await h.post({ image: PNG })).json().imports_left).toBe(0);
    const blocked = await h.post({ image: PNG });
    expect(blocked.statusCode).toBe(429);

    // A new NFL week resets it.
    await h.lineupCache.setNflState(
      { season: '2026', week: 6, seasonType: 'regular', seasonStartDate: '2026-09-09' },
      600,
    );
    expect((await h.post({ image: PNG })).statusCode).toBe(200);
  });

  it('allows ten Pro imports per NFL week and reports the remaining allowance', async () => {
    const h = await harness({ tier: 'pro' });
    for (let used = 1; used <= 10; used += 1) {
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(200);
      expect(response.json().imports_left).toBe(10 - used);
    }
    const blocked = await h.post({ image: PNG });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toEqual({
      code: 'slip_import_limit',
      message:
        'You’ve used this week’s 10 screenshot imports. You can still add picks yourself, and imports reset next week.',
      details: { limit: 10 },
    });
    expect(h.reader?.calls).toHaveLength(10);
  });

  it('keeps Pro usage across a new ET day in the same NFL week and resets next week', async () => {
    const h = await harness({ tier: 'pro' });
    for (let used = 1; used <= 10; used += 1) await h.post({ image: PNG });
    // Oct 9 at noon ET to Oct 10 at 4 AM ET; still NFL week 5, within the TTL.
    h.setNow(new Date('2026-10-10T08:00:00.000Z'));
    expect((await h.post({ image: PNG })).statusCode).toBe(429);
    expect(h.reader?.calls).toHaveLength(10);

    await h.lineupCache.setNflState(
      { season: '2026', week: 6, seasonType: 'regular', seasonStartDate: '2026-09-09' },
      600,
    );
    const response = await h.post({ image: PNG });
    expect(response.statusCode).toBe(200);
    expect(response.json().imports_left).toBe(9);
  });

  it.each(['free', 'pro'] as const)(
    'gives the import back for %s when the model call fails on our side',
    async (tier) => {
      const reader = new FakeReader(new SlipReadError('upstream', 529));
      const h = await harness({ tier, reader, limits: { free: 1, pro: 1 } });
      const failed = await h.post({ image: PNG });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe('slip_import_failed');
      reader.result = { is_bet_slip: true, bet_count: 1, legs: [RUSH_LEG] };
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(200);
      expect(response.json().imports_left).toBe(0);
      expect((await h.post({ image: PNG })).statusCode).toBe(429);
    },
  );

  it.each([
    [
      'an image that is not a slip',
      { is_bet_slip: false, bet_count: 0, legs: [] },
      'slip_import_unreadable',
    ],
    [
      'a slip with no legs',
      { is_bet_slip: true, bet_count: 1, legs: [] },
      'slip_import_unreadable',
    ],
    [
      'several bets',
      { is_bet_slip: true, bet_count: 2, legs: [RUSH_LEG, RUSH_LEG] },
      'slip_import_multiple_bets',
    ],
    [
      'more legs than a parlay holds',
      { is_bet_slip: true, bet_count: 1, legs: Array.from({ length: 13 }, () => RUSH_LEG) },
      'slip_import_too_many_legs',
    ],
  ])('answers 422 for %s', async (_name, read, code) => {
    const h = await harness({ reader: new FakeReader(read as SlipRead) });
    const response = await h.post({ image: PNG });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(code);
  });

  it('answers 422 when the model could not read the slip, and keeps the import spent', async () => {
    const reader = new FakeReader(new SlipReadError('unparseable'));
    const h = await harness({ reader, limits: { free: 1, pro: 1 } });
    expect((await h.post({ image: PNG })).statusCode).toBe(422);
    expect((await h.post({ image: PNG })).statusCode).toBe(429);
  });
});
