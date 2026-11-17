import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicSlipReader,
  SLIP_READ_MODEL,
  SLIP_CONFIRM_MODEL,
  ConfirmingSlipReader,
  SLIP_READ_PROMPT,
  SlipReadError,
  sniffImageType,
} from './reader.js';
import { SLIP_READ_JSON_SCHEMA, slipLegSchema, type SlipLeg, type SlipRead } from './schema.js';
import { leg } from './fixtures.test-helper.js';

function fakeClient(result: unknown) {
  const create = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

function message(text: string, stop_reason = 'end_turn') {
  return { content: [{ type: 'text', text }], stop_reason };
}

/** The model's per-bet answer for one straight bet, and the flattened read it becomes. */
const SLIP = {
  is_bet_slip: true,
  bet_count: 1,
  bets: [{ bet_type: 'single', legs: [leg({ text: 'PHI ML' })] }],
};
const SLIP_READ: SlipRead = {
  is_bet_slip: true,
  bet_count: 1,
  legs: [leg({ text: 'PHI ML' })],
  bets: [{ bet_type: 'single', leg_count: 1 }],
};

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
const IMAGE = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };

describe('AnthropicSlipReader', () => {
  it('sends the image with the strict schema to the server-side model and parses the answer', async () => {
    const { client, create } = fakeClient(message(JSON.stringify(SLIP)));
    const read = await new AnthropicSlipReader('unused', client).read(IMAGE);

    expect(read).toEqual(SLIP_READ);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]?.[0 as never] as unknown as Record<string, unknown>;
    expect(params).toMatchObject({
      model: SLIP_READ_MODEL,
      output_config: { format: { type: 'json_schema', schema: SLIP_READ_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: IMAGE.data },
            },
            { type: 'text' },
          ],
        },
      ],
    });
  });

  it.each([SLIP_READ_MODEL, SLIP_CONFIRM_MODEL])(
    'passes model %s and its supported request options',
    async (model) => {
      const { client, create } = fakeClient(message(JSON.stringify(SLIP)));
      await new AnthropicSlipReader('unused', client, model).read(IMAGE);
      const params = create.mock.calls[0]?.[0 as never] as unknown as Record<string, unknown>;
      expect(params).toMatchObject({ model, output_config: { effort: 'medium' } });
      if (model === SLIP_READ_MODEL) {
        expect(params).not.toHaveProperty('betas');
        expect(params).not.toHaveProperty('fallbacks');
      } else {
        expect(params).toMatchObject({
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      }
    },
  );

  it.each([
    ['a refusal', message('', 'refusal'), 'refused'],
    ['a cut-off answer', message('{"is_bet', 'max_tokens'), 'unparseable'],
    ['text that is not JSON', message('not json'), 'unparseable'],
    ['JSON outside the schema', message('{"legs": "nope"}'), 'unparseable'],
    [
      'the flat pre-grouping answer',
      message(JSON.stringify({ is_bet_slip: true, bet_count: 1, legs: [leg()] })),
      'unparseable',
    ],
  ])('throws on %s', async (_name, response, reason) => {
    const { client } = fakeClient(response);
    await expect(new AnthropicSlipReader('unused', client).read(IMAGE)).rejects.toMatchObject({
      reason,
    });
  });

  it('reports API failures as upstream with the status only', async () => {
    const apiError = new Anthropic.APIError(529, undefined, 'overloaded', new Headers());
    const { client } = fakeClient(apiError);
    const error = await new AnthropicSlipReader('unused', client).read(IMAGE).catch((e) => e);
    expect(error).toBeInstanceOf(SlipReadError);
    expect(error).toMatchObject({ reason: 'upstream', status: 529 });
  });

  it('reports network failures as upstream', async () => {
    const { client } = fakeClient(new TypeError('fetch failed'));
    await expect(new AnthropicSlipReader('unused', client).read(IMAGE)).rejects.toMatchObject({
      reason: 'upstream',
    });
  });
});

describe('SLIP_READ_JSON_SCHEMA', () => {
  it('requires every leg field the zod schema reads', () => {
    const properties = SLIP_READ_JSON_SCHEMA['properties'] as {
      bets: { items: { properties: { legs: { items: { required: string[] } } } } };
    };
    const legSchema = properties.bets.items.properties.legs.items;
    expect([...legSchema.required].sort()).toEqual(Object.keys(slipLegSchema.shape).sort());
  });

  it('groups legs under bets, each with a bet type, and has no flat leg list', () => {
    expect(SLIP_READ_JSON_SCHEMA['required']).toEqual(['is_bet_slip', 'bet_count', 'bets']);
    const properties = SLIP_READ_JSON_SCHEMA['properties'] as Record<string, unknown>;
    expect(properties).not.toHaveProperty('legs');
    expect(properties['bets']).toMatchObject({
      items: {
        required: ['bet_type', 'legs'],
        properties: { bet_type: { enum: ['single', 'parlay'] } },
      },
    });
  });
});

describe('sniffImageType', () => {
  const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0, 0, 0, 0, 0]);
  it.each([
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/gif', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ['image/webp', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)],
  ])('detects %s', (type, data) => {
    expect(sniffImageType(data)).toBe(type);
  });

  it('rejects anything else', () => {
    expect(sniffImageType(new TextEncoder().encode('%PDF-1.7 hello'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

// These guard the instructions sent to the reader, not live model accuracy.
describe('slip reading instructions', () => {
  it.each([
    'RUSH_REC_YDS (rushing + receiving yards)',
    'If the printed stat is not in this list (tackles, sacks, defensive or special-teams stats',
    'unsupported combined stats such as passing + rushing yards, or anything else), return market: OTHER with stat: null',
    'Never substitute the closest supported stat',
    'MORE, HIGHER and OVER mean OVER',
    'LESS, LOWER and UNDER mean UNDER',
    'up = OVER, down = UNDER',
    'When both arrows are present, the other arrow is just the unselected option',
    'If neither is highlighted and no side is otherwise shown, leave side null',
    'Never guess a side',
    'Count bets, not legs: legs listed together under one pick amount or payout are one bet',
    'including a parlay with a status mark or progress bar on each leg, a settled parlay, or a same-game parlay',
    'Set bet_count to 1 for that parlay; per-leg status marks and progress bars do not make separate bets',
    'Set bet_count greater than 1 only when the screenshot shows separate bets, each with its own pick amount or payout',
    'the logo or jersey beside the leg, or the matchup line',
    'For player legs with no printed team name, use these visual cues beside the player or the matchup header',
    'Use null only when the team truly cannot be told (or for game totals)',
    'Do not guess anything the slip does not show: use null',
    'Prefer printed team text when a logo disagrees',
    "pick'em entry fees, prize tables, boosts, and rewards",
    'Return one entry in bets for every separate bet, in the order shown, so bets has bet_count entries',
    'never move a leg to another bet or split one parlay into several bets',
    'bet_type is single for a straight bet with one leg and parlay for a bet with two or more legs',
  ])('instructs the reader: %s', (instruction) => {
    expect(SLIP_READ_PROMPT).toContain(instruction);
  });

  it.each(['OVER', 'UNDER', null] as const)(
    'preserves the reader’s side %s without filling it in',
    async (side) => {
      const legs = [
        leg({
          market: 'PLAYER_STAT',
          stat: 'RUSH_YDS',
          player: 'Saquon Barkley',
          line: 84.5,
          side,
        }),
      ];
      const fixture = { ...SLIP, bets: [{ bet_type: 'single', legs }] };
      const { client, create } = fakeClient(message(JSON.stringify(fixture)));
      expect(await new AnthropicSlipReader('unused', client).read(IMAGE)).toEqual({
        ...SLIP_READ,
        legs,
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.arrayContaining([{ type: 'text', text: SLIP_READ_PROMPT }]),
            }),
          ],
        }),
      );
    },
  );
});

describe('AnthropicSlipReader with several bets', () => {
  it('flattens legs in printed order and keeps each bet’s span', async () => {
    const a = leg({ text: 'a' });
    const b = leg({ text: 'b' });
    const c = leg({ text: 'c' });
    const answer = {
      is_bet_slip: true,
      bet_count: 2,
      bets: [
        { bet_type: 'parlay', legs: [a, b] },
        { bet_type: 'single', legs: [c] },
      ],
    };
    const { client } = fakeClient(message(JSON.stringify(answer)));
    expect(await new AnthropicSlipReader('unused', client).read(IMAGE)).toEqual({
      is_bet_slip: true,
      bet_count: 2,
      legs: [a, b, c],
      bets: [
        { bet_type: 'parlay', leg_count: 2 },
        { bet_type: 'single', leg_count: 1 },
      ],
    });
  });
});

describe('ConfirmingSlipReader', () => {
  const ML = leg({ text: 'PHI ML', market: 'MONEYLINE', team: 'PHI' });
  const RUSH = leg({
    text: 'Barkley o84.5',
    market: 'PLAYER_STAT',
    stat: 'RUSH_YDS',
    player: 'Saquon Barkley',
    side: 'OVER',
    line: 84.5,
  });

  it.each([
    SLIP_READ,
    { is_bet_slip: false, bet_count: 2, legs: [] },
    { is_bet_slip: true, bet_count: 0, legs: [] },
    { is_bet_slip: true, bet_count: 1, legs: [] },
    { ...SLIP_READ, legs: Array.from({ length: 13 }, () => leg()), bets: undefined },
    grouped([ML, RUSH]),
  ])('does not confirm a read other than multiple bets: %j', async (read) => {
    const primary = { read: vi.fn().mockResolvedValue(read) };
    const confirm = { read: vi.fn() };
    expect(await new ConfirmingSlipReader(primary, confirm).read(IMAGE)).toBe(read);
    expect(primary.read).toHaveBeenCalledExactlyOnceWith(IMAGE);
    expect(confirm.read).not.toHaveBeenCalled();
  });

  it.each([
    ['its count', { ...SLIP_READ, bet_count: 2 }],
    ['its grouping', { ...grouped([ML], [RUSH]), bet_count: 1 }],
  ])('confirms a read that says several bets by %s', async (_name, read) => {
    const confirm = { read: vi.fn().mockResolvedValue(read) };
    await new ConfirmingSlipReader({ read: async () => read }, confirm).read(IMAGE);
    expect(confirm.read).toHaveBeenCalledExactlyOnceWith(IMAGE);
  });

  it('returns the confirm read marked agreed when the reads hold the same bets', async () => {
    const primary = { read: vi.fn().mockResolvedValue(grouped([ML], [RUSH])) };
    const confirmed = grouped([{ ...RUSH, text: 'other text', odds: '-120' }], [ML]);
    const confirm = { read: vi.fn().mockResolvedValue(confirmed) };
    expect(await new ConfirmingSlipReader(primary, confirm).read(IMAGE)).toEqual({
      ...confirmed,
      confirmation: 'agreed',
    });
    expect(primary.read).toHaveBeenCalledExactlyOnceWith(IMAGE);
    expect(confirm.read).toHaveBeenCalledExactlyOnceWith(IMAGE);
  });

  it.each([
    ['one parlay instead of two singles', grouped([ML, RUSH])],
    ['a different line', grouped([ML], [{ ...RUSH, line: 90.5 }])],
    ['a different side', grouped([ML], [{ ...RUSH, side: 'UNDER' }])],
    ['an extra bet', grouped([ML], [RUSH], [ML])],
    ['not a bet slip', { is_bet_slip: false, bet_count: 0, legs: [] }],
  ])('returns the confirm read marked disagreed for %s', async (_name, confirmed) => {
    const primary = { read: async () => grouped([ML], [RUSH]) };
    const confirm = { read: vi.fn().mockResolvedValue(confirmed) };
    expect(await new ConfirmingSlipReader(primary, confirm).read(IMAGE)).toEqual({
      ...confirmed,
      confirmation: 'disagreed',
    });
  });

  it.each(['upstream', 'refused', 'unparseable'] as const)(
    'keeps the primary read marked failed on a %s confirmation error',
    async (reason) => {
      const read = grouped([ML], [RUSH]);
      const confirm = { read: vi.fn().mockRejectedValue(new SlipReadError(reason)) };
      expect(
        await new ConfirmingSlipReader({ read: async () => read }, confirm).read(IMAGE),
      ).toEqual({ ...read, confirmation: 'failed' });
      expect(confirm.read).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates primary errors without confirming', async () => {
    const error = new SlipReadError('upstream');
    const primary = { read: vi.fn().mockRejectedValue(error) };
    const confirm = { read: vi.fn() };
    await expect(new ConfirmingSlipReader(primary, confirm).read(IMAGE)).rejects.toBe(error);
    expect(confirm.read).not.toHaveBeenCalled();
  });

  it('propagates unexpected confirmation errors', async () => {
    const error = new Error('programming error');
    const primary = { read: async () => ({ ...SLIP_READ, bet_count: 2 }) };
    const confirm = { read: vi.fn().mockRejectedValue(error) };
    await expect(new ConfirmingSlipReader(primary, confirm).read(IMAGE)).rejects.toBe(error);
  });
});
