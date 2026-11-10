import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { readSlipWithModel } from './multiModelReader.js';
import { SlipReadError } from './reader.js';
import { leg } from './fixtures.test-helper.js';

function fakeClient(result: unknown) {
  const create = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

function message(text: string, usage: { input_tokens: number; output_tokens: number }) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage };
}

const SLIP = { is_bet_slip: true, bet_count: 1, legs: [leg({ text: 'PHI ML' })] };
const IMAGE = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };

describe('readSlipWithModel', () => {
  it('sends the requested model and returns the parsed slip with usage', async () => {
    const { client, create } = fakeClient(
      message(JSON.stringify(SLIP), { input_tokens: 1234, output_tokens: 56 }),
    );
    const result = await readSlipWithModel(client, 'claude-haiku-5-5', IMAGE);

    expect(result.read).toEqual(SLIP);
    expect(result.usage).toEqual({ input_tokens: 1234, output_tokens: 56 });
    const params = create.mock.calls[0]?.[0 as never] as unknown as Record<string, unknown>;
    expect(params).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('throws unparseable on JSON outside the schema, same as the production reader', async () => {
    const { client } = fakeClient(
      message('{"legs": "nope"}', { input_tokens: 1, output_tokens: 1 }),
    );
    await expect(readSlipWithModel(client, 'claude-sonnet-5-5', IMAGE)).rejects.toMatchObject({
      reason: 'unparseable',
    });
  });

  it('reports API failures as upstream with the status', async () => {
    const apiError = new Anthropic.APIError(529, undefined, 'overloaded', new Headers());
    const { client } = fakeClient(apiError);
    const error = await readSlipWithModel(client, 'claude-opus-5-5', IMAGE).catch((e) => e);
    expect(error).toBeInstanceOf(SlipReadError);
    expect(error).toMatchObject({ reason: 'upstream', status: 529 });
  });
});
