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
import {
  ConfirmingSlipReader,
  SlipReadError,
  type SlipImage,
  type SlipReader,
} from '../lib/slipImport/reader.js';
import type { SlipLeg, SlipRead } from '../lib/slipImport/schema.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import authPlugin from '../plugins/auth.js';
import servicesPlugin from '../plugins/services.js';
import { unreachableNflStateSource } from '../lib/nflStateSource.test-helper.js';
import pickImportRoutes, { MAX_IMPORT_BETS } from './pickImport.js';

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
    composedReader?: SlipReader;
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
    reader: options.composedReader ?? reader,
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
  const postMulti = (payload: unknown, capability = 'v1') =>
    app.inject({
      method: 'POST',
      url: `/picks/import?multi_bet=${capability}`,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });
  return {
    app,
    db,
    reader,
    logs,
    post,
    postMulti,
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

  it.each(['agrees', 'fails'] as const)(
    'keeps the multiple-bet refusal when confirmation %s',
    async (mode) => {
      const read = { is_bet_slip: true, bet_count: 2, legs: [RUSH_LEG, RUSH_LEG] };
      const primary = new FakeReader(read);
      const confirm = new FakeReader(mode === 'agrees' ? read : new SlipReadError('upstream'));
      const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'slip_import_multiple_bets',
        message: 'That screenshot shows more than one bet. Crop it to one bet and try again.',
      });
      expect(primary.calls).toHaveLength(1);
      expect(confirm.calls).toHaveLength(1);
      expect(h.logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(h.logs.join('')).not.toContain(RUSH_LEG.text);
    },
  );

  it('imports the corrected single-bet read after confirmation', async () => {
    const primary = new FakeReader({ is_bet_slip: true, bet_count: 2, legs: [OTHER_LEG] });
    const confirm = new FakeReader({ is_bet_slip: true, bet_count: 1, legs: [RUSH_LEG] });
    const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
    const response = await h.post({ image: PNG });
    expect(response.statusCode).toBe(200);
    expect(response.json().legs).toHaveLength(1);
    expect(response.json().legs[0].status).toBe('ready');
  });

  it('answers 422 when the model could not read the slip, and keeps the import spent', async () => {
    const reader = new FakeReader(new SlipReadError('unparseable'));
    const h = await harness({ reader, limits: { free: 1, pro: 1 } });
    expect((await h.post({ image: PNG })).statusCode).toBe(422);
    expect((await h.post({ image: PNG })).statusCode).toBe(429);
  });
});

const ML_LEG = leg({ text: 'Eagles Moneyline', market: 'MONEYLINE', team: 'PHI' });
const NY_TOTAL_LEG = leg({
  text: 'Giants at Jets Under 41.5',
  market: 'GAME_TOTAL',
  side: 'UNDER',
  line: 41.5,
  matchup: ['NY Giants', 'NY Jets'],
});

/** A grouped read, as the reader returns it: one entry in `bets` per bet, in printed order. */
function grouped(...bets: SlipLeg[][]): SlipRead {
  return {
    is_bet_slip: true,
    bet_count: bets.length,
    legs: bets.flat(),
    bets: bets.map((legs) => ({
      bet_type: legs.length > 1 ? ('parlay' as const) : ('single' as const),
      leg_count: legs.length,
    })),
  };
}

type BetBody = { bet_type: string; legs: { status: string; text: string }[] };

describe('POST /picks/import with multiple bets', () => {
  const apps: { close(): Promise<unknown> }[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  async function harness(options: Parameters<typeof setup>[0] = {}) {
    const h = await setup(options);
    apps.push(h.app);
    return h;
  }

  describe('a legacy client (iOS 1.1.0, no capability)', () => {
    it('gets exactly the original contract for a one-bet grouped read', async () => {
      const h = await harness({ reader: new FakeReader(grouped([RUSH_LEG, ML_LEG])) });
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Object.keys(body).sort()).toEqual(['imports_left', 'kind', 'legs']);
      expect(body.kind).toBe('parlay');
      expect(body.legs.map((l: { status: string }) => l.status)).toEqual(['ready', 'ready']);
    });

    it('still gets the multiple-bets 422, and the import is refunded', async () => {
      const reader = new FakeReader(grouped([RUSH_LEG], [ML_LEG]));
      const h = await harness({ reader, limits: { free: 1, pro: 1 } });
      const refused = await h.post({ image: PNG });
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error).toEqual({
        code: 'slip_import_multiple_bets',
        message: 'That screenshot shows more than one bet. Crop it to one bet and try again.',
      });
      // The only import of the week is still there.
      reader.result = grouped([RUSH_LEG]);
      const next = await h.post({ image: PNG });
      expect(next.statusCode).toBe(200);
      expect(next.json().imports_left).toBe(0);
      expect((await h.post({ image: PNG })).statusCode).toBe(429);
    });

    it('refunds the import for a flat read whose count says several bets', async () => {
      const reader = new FakeReader({ is_bet_slip: true, bet_count: 3, legs: [RUSH_LEG] });
      const h = await harness({ reader, limits: { free: 1, pro: 1 } });
      expect((await h.post({ image: PNG })).statusCode).toBe(422);
      reader.result = grouped([RUSH_LEG]);
      expect((await h.post({ image: PNG })).statusCode).toBe(200);
    });

    it('refuses a read grouped into two bets even when its count says one', async () => {
      const read = { ...grouped([RUSH_LEG], [ML_LEG]), bet_count: 1 };
      const h = await harness({ reader: new FakeReader(read) });
      const response = await h.post({ image: PNG });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('slip_import_multiple_bets');
    });

    it('treats an unknown capability value as a legacy client', async () => {
      const h = await harness({ reader: new FakeReader(grouped([RUSH_LEG], [ML_LEG])) });
      const response = await h.postMulti({ image: PNG }, 'v999');
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('slip_import_multiple_bets');
    });

    it('keeps the multiple-bet refusal when the confirm read agrees', async () => {
      const read = grouped([RUSH_LEG], [ML_LEG]);
      const confirm = new FakeReader(read);
      const h = await harness({
        composedReader: new ConfirmingSlipReader(new FakeReader(read), confirm),
      });
      expect((await h.post({ image: PNG })).statusCode).toBe(422);
      expect(confirm.calls).toHaveLength(1);
    });
  });

  describe('a multi-bet client', () => {
    it('imports several singles grouped per bet, and charges one import', async () => {
      const reader = new FakeReader(grouped([RUSH_LEG], [ML_LEG], [NY_TOTAL_LEG]));
      const h = await harness({ reader });
      const response = await h.postMulti({ image: PNG });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.imports_left).toBe(2);
      expect(body.review).toBe(false);
      expect(body.kind).toBe('parlay');
      expect(body.legs).toHaveLength(3);
      expect(body.bets.map((b: BetBody) => [b.bet_type, b.legs.length])).toEqual([
        ['single', 1],
        ['single', 1],
        ['single', 1],
      ]);
      expect(body.bets.map((b: BetBody) => b.legs[0]?.text)).toEqual([
        RUSH_LEG.text,
        ML_LEG.text,
        NY_TOTAL_LEG.text,
      ]);
      expect(body.bets.flatMap((b: BetBody) => b.legs.map((l) => l.status))).toEqual([
        'ready',
        'ready',
        'ready',
      ]);
      expect(h.db.rows('stakes')).toHaveLength(0);
      expect(h.db.rows('pick_slips')).toHaveLength(0);
    });

    it('imports several parlays with their legs in order', async () => {
      const h = await harness({
        reader: new FakeReader(grouped([RUSH_LEG, ML_LEG], [NY_TOTAL_LEG, OTHER_LEG, ML_LEG])),
      });
      const body = (await h.postMulti({ image: PNG })).json();
      expect(body.review).toBe(false);
      expect(body.bets.map((b: BetBody) => [b.bet_type, b.legs.map((l) => l.text)])).toEqual([
        ['parlay', [RUSH_LEG.text, ML_LEG.text]],
        ['parlay', [NY_TOTAL_LEG.text, OTHER_LEG.text, ML_LEG.text]],
      ]);
      expect(body.bets[1].legs[1]).toMatchObject({ status: 'flagged' });
    });

    it('imports a mix of singles and parlays', async () => {
      const h = await harness({
        reader: new FakeReader(grouped([RUSH_LEG], [ML_LEG, NY_TOTAL_LEG], [OTHER_LEG])),
      });
      const body = (await h.postMulti({ image: PNG })).json();
      expect(body.bets.map((b: BetBody) => `${b.bet_type}:${b.legs.length}`)).toEqual([
        'single:1',
        'parlay:2',
        'single:1',
      ]);
      expect(body.bets[2].legs[0]).toMatchObject({ status: 'flagged', text: OTHER_LEG.text });
    });

    it('returns one bet for a one-bet slip, with the legacy fields intact', async () => {
      const h = await harness({ reader: new FakeReader(grouped([RUSH_LEG, ML_LEG])) });
      const body = (await h.postMulti({ image: PNG })).json();
      expect(body).toMatchObject({ kind: 'parlay', imports_left: 2, review: false });
      expect(body.legs).toHaveLength(2);
      expect(body.bets).toHaveLength(1);
      expect(body.bets[0].legs).toEqual(body.legs);
    });

    it('still charges an import for a multi-bet read; one screenshot is one import', async () => {
      const h = await harness({
        reader: new FakeReader(grouped([RUSH_LEG], [ML_LEG])),
        limits: { free: 1, pro: 1 },
      });
      expect((await h.postMulti({ image: PNG })).json().imports_left).toBe(0);
      expect((await h.postMulti({ image: PNG })).statusCode).toBe(429);
    });

    it('imports the confirm read without review when the two reads agree', async () => {
      const primary = new FakeReader(grouped([RUSH_LEG], [ML_LEG, NY_TOTAL_LEG]));
      // Same bets in another order, and printed text differs: still agreement.
      const confirm = new FakeReader(
        grouped([NY_TOTAL_LEG, { ...ML_LEG, text: 'PHI ML' }], [RUSH_LEG]),
      );
      const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
      const body = (await h.postMulti({ image: PNG })).json();
      expect(body.review).toBe(false);
      expect(body.bets[0].legs[1].text).toBe('PHI ML');
      expect(primary.calls).toHaveLength(1);
      expect(confirm.calls).toHaveLength(1);
    });

    it('sends the confirm read to review when the reads group legs differently', async () => {
      const primary = new FakeReader(grouped([RUSH_LEG], [ML_LEG]));
      const confirm = new FakeReader(grouped([RUSH_LEG, ML_LEG]));
      const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
      const response = await h.postMulti({ image: PNG });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.review).toBe(true);
      expect(body.bets.map((b: BetBody) => b.bet_type)).toEqual(['parlay']);
    });

    it('sends the read to review when the reads disagree on a leg', async () => {
      const primary = new FakeReader(grouped([RUSH_LEG], [ML_LEG]));
      const confirm = new FakeReader(grouped([{ ...RUSH_LEG, line: 94.5 }], [ML_LEG]));
      const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
      expect((await h.postMulti({ image: PNG })).json().review).toBe(true);
    });

    it('keeps the primary read but requires review when the confirm call fails', async () => {
      const primary = new FakeReader(grouped([RUSH_LEG], [ML_LEG]));
      const confirm = new FakeReader(new SlipReadError('upstream', 529));
      const h = await harness({ composedReader: new ConfirmingSlipReader(primary, confirm) });
      const response = await h.postMulti({ image: PNG });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ review: true, imports_left: 2 });
      expect(response.json().bets).toHaveLength(2);
    });

    it('sends an inconsistent read to review', async () => {
      const read = { ...grouped([RUSH_LEG], [ML_LEG]), bet_count: 3 };
      const h = await harness({ reader: new FakeReader(read) });
      expect((await h.postMulti({ image: PNG })).json().review).toBe(true);
    });

    it('refuses more bets than one import returns', async () => {
      const bets = Array.from({ length: MAX_IMPORT_BETS + 1 }, () => [RUSH_LEG]);
      const h = await harness({ reader: new FakeReader(grouped(...bets)) });
      const response = await h.postMulti({ image: PNG });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('slip_import_too_many_bets');
    });

    it('refuses a bet with more legs than a parlay holds, but not many legs across bets', async () => {
      const twelve = Array.from({ length: 12 }, () => RUSH_LEG);
      const ok = await harness({ reader: new FakeReader(grouped(twelve, [ML_LEG])) });
      expect((await ok.postMulti({ image: PNG })).statusCode).toBe(200);
      const tooMany = await harness({ reader: new FakeReader(grouped([...twelve, ML_LEG])) });
      const response = await tooMany.postMulti({ image: PNG });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('slip_import_too_many_legs');
    });

    it('never logs the image or what the model read', async () => {
      const h = await harness({ reader: new FakeReader(grouped([RUSH_LEG], [ML_LEG])) });
      await h.postMulti({ image: PNG });
      const all = h.logs.join('\n');
      expect(all).toContain('"bets":2');
      expect(all).not.toContain(PRIVATE_MARKER);
      expect(all).not.toContain('bettor99');
      expect(all).not.toContain('Barkley');
      expect(all).not.toContain('Eagles');
    });
  });
});
