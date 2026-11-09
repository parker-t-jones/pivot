import Anthropic from '@anthropic-ai/sdk';
import { SLIP_READ_JSON_SCHEMA, slipReadSchema, type SlipRead } from './schema.js';

export type SlipImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface SlipImage {
  mediaType: SlipImageType;
  /** Base64, no data-URL prefix. */
  data: string;
}

/**
 * Reads a bet slip screenshot into legs. The image and the model's answer stay in memory: callers
 * must not store or log either (slips show balances, usernames, and bet IDs).
 */
export interface SlipReader {
  read(image: SlipImage): Promise<SlipRead>;
}

/** The model could not read the slip into the schema, or the API call failed. */
export class SlipReadError extends Error {
  constructor(
    readonly reason: 'upstream' | 'refused' | 'unparseable',
    /** HTTP status from the Claude API, when there was one. Safe to log. */
    readonly status?: number,
  ) {
    super(`slip read failed: ${reason}`);
  }
}

export const SLIP_READ_MODEL = 'claude-opus-5-5';

export const SLIP_READ_PROMPT = `Read this sportsbook bet slip screenshot for an NFL pick tracker.

Return every leg of the bet as printed. For each leg:
- market: MONEYLINE (win the game), SPREAD (point spread, including alternate spreads), GAME_TOTAL (both teams' combined points), TEAM_TOTAL (one team's points), PLAYER_STAT (over/under or N+ on a player stat), ANYTIME_TD (player scores a touchdown), FIRST_TD (player scores the first touchdown), FIRST_TO_SCORE (team scores first), FIELD_GOALS (field goals made by a team or by both teams), or OTHER for anything else (exact score, winning margin, longest reception, combined player props, non-NFL, and so on).
- stat for PLAYER_STAT: PASS_YDS, PASS_COMP, PASS_ATT, PASS_TD, INT_THROWN, RUSH_YDS, RUSH_ATT, REC_YDS, RECEPTIONS, ANY_TD (touchdowns scored, e.g. "2+ touchdowns"), FG_MADE, or KICK_PTS. Use OTHER as the market when none fits, e.g. rushing + receiving yards.
- period: FULL unless the leg is for one quarter (Q1-Q4) or half (H1, H2).
- Copy names, numbers, and signs exactly as printed. Do not guess anything the slip does not show: use null.

Only describe the bet itself. Leave out account balances, usernames, bet IDs, stakes, payouts, and promotions.
If the image is not a bet slip, set is_bet_slip to false and return no legs.`;

export class AnthropicSlipReader implements SlipReader {
  private readonly client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    // One quick retry; the user is waiting on a spinner.
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  }

  async read(image: SlipImage): Promise<SlipRead> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: SLIP_READ_MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
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
    return parsed.data;
  }
}

/** Detects the image type from its first bytes. The client's claim is never trusted. */
export function sniffImageType(bytes: Uint8Array): SlipImageType | null {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
