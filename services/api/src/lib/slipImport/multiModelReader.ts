/**
 * Eval-only slip reader (#41): same prompt and JSON schema as `AnthropicSlipReader`, but takes
 * the model as a parameter and returns token usage, so the eval harness can run and cost several
 * models over the same image set. Never imported by the running API: `AnthropicSlipReader` in
 * `reader.ts` (and its pinned `SLIP_READ_MODEL`) is the only production path.
 */
import Anthropic from '@anthropic-ai/sdk';
import { SLIP_READ_PROMPT, SlipReadError, type SlipImage } from './reader.js';
import { SLIP_READ_JSON_SCHEMA, slipReadSchema, type SlipRead } from './schema.js';
import type { TokenUsage } from './modelCost.js';

export interface ModelSlipRead {
  read: SlipRead;
  usage: TokenUsage;
}

export async function readSlipWithModel(
  client: Anthropic,
  model: string,
  image: SlipImage,
): Promise<ModelSlipRead> {
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SLIP_READ_JSON_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            },
            { type: 'text', text: SLIP_READ_PROMPT },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new SlipReadError(
        'upstream',
        typeof error.status === 'number' ? error.status : undefined,
      );
    }
    throw new SlipReadError('upstream');
  }

  if (message.stop_reason === 'refusal') throw new SlipReadError('refused');
  if (message.stop_reason === 'max_tokens') throw new SlipReadError('unparseable');
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SlipReadError('unparseable');
  }
  const parsed = slipReadSchema.safeParse(json);
  if (!parsed.success) throw new SlipReadError('unparseable');
  return {
    read: parsed.data,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    },
  };
}

/** Eval adapter; production reader stays unchanged and can be injected in offline tests. */
export function productionModelReader(
  reader: import('./reader.js').SlipReader,
  observedUsage: () => TokenUsage | null,
): import('./modelEval.js').ModelReader {
  return async (_model, image) => ({ read: await reader.read(image), usage: observedUsage() });
}
