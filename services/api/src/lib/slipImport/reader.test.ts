import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicSlipReader,
  SLIP_READ_MODEL,
  SLIP_READ_PROMPT,
  SlipReadError,
  sniffImageType,
} from './reader.js';
import { SLIP_READ_JSON_SCHEMA, slipReadSchema } from './schema.js';
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

const SLIP = { is_bet_slip: true, bet_count: 1, legs: [leg({ text: 'PHI ML' })] };
const IMAGE = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };

describe('AnthropicSlipReader', () => {
  it('sends the image with the strict schema to the server-side model and parses the answer', async () => {
    const { client, create } = fakeClient(message(JSON.stringify(SLIP)));
    const read = await new AnthropicSlipReader('unused', client).read(IMAGE);

    expect(read).toEqual(SLIP);
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

  it.each([
    ['a refusal', message('', 'refusal'), 'refused'],
    ['a cut-off answer', message('{"is_bet', 'max_tokens'), 'unparseable'],
    ['text that is not JSON', message('not json'), 'unparseable'],
    ['JSON outside the schema', message('{"legs": "nope"}'), 'unparseable'],
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
      legs: { items: { required: string[] } };
    };
    const legSchema = properties.legs.items;
    expect([...legSchema.required].sort()).toEqual(
      Object.keys(slipReadSchema.shape.legs.element.shape).sort(),
    );
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
    'MORE, HIGHER and OVER mean OVER',
    'LESS, LOWER and UNDER mean UNDER',
    'up = OVER, down = UNDER',
    'When both arrows are present, the other arrow is just the unselected option',
    'If neither is highlighted and no side is otherwise shown, leave side null',
    'Never guess a side',
    'the logo or jersey beside the leg, or the matchup line',
    'Prefer printed team text when a logo disagrees',
    "pick'em entry fees, prize tables, boosts, and rewards",
  ])('instructs the reader: %s', (instruction) => {
    expect(SLIP_READ_PROMPT).toContain(instruction);
  });

  it.each(['OVER', 'UNDER', null] as const)(
    'preserves the reader’s side %s without filling it in',
    async (side) => {
      const fixture = {
        ...SLIP,
        legs: [
          leg({
            market: 'PLAYER_STAT',
            stat: 'RUSH_YDS',
            player: 'Saquon Barkley',
            line: 84.5,
            side,
          }),
        ],
      };
      const { client, create } = fakeClient(message(JSON.stringify(fixture)));
      expect(await new AnthropicSlipReader('unused', client).read(IMAGE)).toEqual(fixture);
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
