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

export const SLIP_READ_MODEL = 'claude-haiku-5-5';
export const SLIP_CONFIRM_MODEL = 'claude-sonnet-5-5';

export const SLIP_READ_PROMPT = `Read this sportsbook bet slip screenshot for an NFL pick tracker.

Count bets, not legs: legs listed together under one pick amount or payout are one bet, including a parlay with a status mark or progress bar on each leg, a settled parlay, or a same-game parlay. Set bet_count to 1 for that parlay; per-leg status marks and progress bars do not make separate bets. Set bet_count greater than 1 only when the screenshot shows separate bets, each with its own pick amount or payout.

Return every leg of the bet as printed. For each leg:
- market: MONEYLINE (win the game), SPREAD (point spread, including alternate spreads), GAME_TOTAL (both teams' combined points), TEAM_TOTAL (one team's points), PLAYER_STAT (over/under or N+ on a player stat), ANYTIME_TD (player scores a touchdown), FIRST_TD (player scores the first touchdown), FIRST_TO_SCORE (team scores first), FIELD_GOALS (field goals made by a team or by both teams), or OTHER for anything else (exact score, winning margin, longest reception, unsupported combined player props such as passing + rushing yards, non-NFL, and so on).
- stat for PLAYER_STAT: PASS_YDS, PASS_COMP, PASS_ATT, PASS_TD, INT_THROWN, RUSH_YDS, RUSH_ATT, RUSH_REC_YDS (rushing + receiving yards), REC_YDS, RECEPTIONS, ANY_TD (touchdowns scored, e.g. "2+ touchdowns"), FG_MADE, or KICK_PTS. If the printed stat is not in this list (tackles, sacks, defensive or special-teams stats, unsupported combined stats such as passing + rushing yards, or anything else), return market: OTHER with stat: null. Never substitute the closest supported stat.
- team: The team the pick is on, from printed text, the logo or jersey beside the leg, or the matchup line. For player legs with no printed team name, use these visual cues beside the player or the matchup header. Prefer printed team text when a logo disagrees. Use null only when the team truly cannot be told (or for game totals). Matching to Pivot players and teams happens afterwards in code.
- side: MORE, HIGHER and OVER mean OVER; LESS, LOWER and UNDER mean UNDER. On a pick'em screen, the highlighted arrow is the side: up = OVER, down = UNDER. When both arrows are present, the other arrow is just the unselected option. If neither is highlighted and no side is otherwise shown, leave side null. Never guess a side.
- period: FULL unless the leg is for one quarter (Q1-Q4) or half (H1, H2).
- Copy names, numbers, and signs exactly as printed. Do not guess anything the slip does not show: use null.

Only describe the bet itself. Leave out account balances, usernames, bet IDs, pick amounts, payouts, promotions, pick'em entry fees, prize tables, boosts, and rewards.
If the image is not a bet slip, set is_bet_slip to false and return no legs.`;

export class AnthropicSlipReader implements SlipReader {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    client?: Anthropic,
    private readonly model = SLIP_READ_MODEL,
  ) {
    // One quick retry; the user is waiting on a spinner.
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  }

  async read(image: SlipImage): Promise<SlipRead> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 8000,
        // Haiku 5.5 has no server-side fallback (Anthropic refusals-and-fallback docs).
        ...(this.model === 'claude-haiku-5-5'
          ? {}
          : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
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

/** Recheck only a multiple-bet read, once. Neither images nor reads are logged or stored. */
export class ConfirmingSlipReader implements SlipReader {
  constructor(
    private readonly primary: SlipReader,
    private readonly confirm: SlipReader,
  ) {}

  async read(image: SlipImage): Promise<SlipRead> {
    const primary = await this.primary.read(image);
    if (!primary.is_bet_slip || primary.bet_count <= 1) return primary;
    try {
      return await this.confirm.read(image);
    } catch (error) {
      if (!(error instanceof SlipReadError)) throw error;
      return primary;
    }
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
