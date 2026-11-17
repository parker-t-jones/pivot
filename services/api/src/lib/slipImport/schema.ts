import { STAT_KEYS, type StatKey } from '@pivot/shared';
import { z } from 'zod';

/**
 * What the model reads off a bet slip screenshot. Every field is required and nullable, so the
 * model says "not on the slip" instead of leaving a key out. Matching to Pivot's players, teams,
 * and games happens afterwards in code (`mapSlip.ts`), never in the model.
 */
export const SLIP_MARKETS = [
  'MONEYLINE',
  'SPREAD',
  'GAME_TOTAL',
  'TEAM_TOTAL',
  'PLAYER_STAT',
  'ANYTIME_TD',
  'FIRST_TD',
  'FIRST_TO_SCORE',
  'FIELD_GOALS',
  'OTHER',
] as const;

export type SlipMarket = (typeof SLIP_MARKETS)[number];

export const SLIP_SIDES = ['OVER', 'UNDER', 'YES', 'NO'] as const;
export const SLIP_PERIODS = ['FULL', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'] as const;

const statKeys = STAT_KEYS as readonly [StatKey, ...StatKey[]];

export const slipLegSchema = z.object({
  text: z.string(),
  market: z.enum(SLIP_MARKETS),
  stat: z.enum(statKeys).nullable(),
  player: z.string().nullable(),
  team: z.string().nullable(),
  matchup: z.array(z.string()),
  side: z.enum(SLIP_SIDES).nullable(),
  line: z.number().nullable(),
  plus_style: z.boolean(),
  period: z.enum(SLIP_PERIODS),
  game_date: z.string().nullable(),
  odds: z.string().nullable(),
});

export type SlipLeg = z.infer<typeof slipLegSchema>;

/** The existing import kinds (`POST /picks/import`'s `kind`), reused per bet. */
export const SLIP_BET_TYPES = ['single', 'parlay'] as const;
export type SlipBetType = (typeof SLIP_BET_TYPES)[number];

/** What the model returns: legs grouped per bet. Converted to `SlipRead` by `fromModelRead`. */
export const modelSlipReadSchema = z.object({
  is_bet_slip: z.boolean(),
  bet_count: z.number().int().min(0),
  bets: z.array(
    z.object({
      bet_type: z.enum(SLIP_BET_TYPES),
      legs: z.array(slipLegSchema),
    }),
  ),
});

export type ModelSlipRead = z.infer<typeof modelSlipReadSchema>;

/** One bet's place in `SlipRead.legs`: the next `leg_count` legs, in printed order. */
export const slipBetSpanSchema = z.object({
  bet_type: z.enum(SLIP_BET_TYPES),
  leg_count: z.number().int().min(0),
});

export type SlipBetSpan = z.infer<typeof slipBetSpanSchema>;

/**
 * A read, as the route and the eval use it: every leg in printed order, plus how those legs are
 * grouped into bets. `bets` is absent on reads saved before multi-bet import; such a read is one
 * group when `bet_count <= 1` and has unknown grouping otherwise (see `bets.ts`).
 */
export const slipReadSchema = z
  .object({
    is_bet_slip: z.boolean(),
    bet_count: z.number().int().min(0),
    legs: z.array(slipLegSchema),
    bets: z.array(slipBetSpanSchema).optional(),
  })
  .refine(
    (read) =>
      read.bets === undefined ||
      read.bets.reduce((sum, bet) => sum + bet.leg_count, 0) === read.legs.length,
    { message: 'bets must cover every leg exactly once' },
  );

export type SlipRead = z.infer<typeof slipReadSchema>;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

/** JSON schema sent as `output_config.format`. Mirrors `modelSlipReadSchema`. */
export const SLIP_READ_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['is_bet_slip', 'bet_count', 'bets'],
  properties: {
    is_bet_slip: {
      type: 'boolean',
      description: 'True when the image shows a sportsbook bet slip or bet ticket.',
    },
    bet_count: {
      type: 'integer',
      description:
        'How many separate bets (tickets) the image shows. A parlay with many legs is one bet.',
    },
    bets: {
      type: 'array',
      description:
        'Every separate bet in the image, in the order shown. A parlay with many legs is one bet.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bet_type', 'legs'],
        properties: {
          bet_type: {
            type: 'string',
            enum: [...SLIP_BET_TYPES],
            description: 'single for a straight bet with one leg; parlay for two or more legs.',
          },
          legs: {
            type: 'array',
            description: 'Every leg of this bet, in the order printed. A straight bet has one leg.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'text',
                'market',
                'stat',
                'player',
                'team',
                'matchup',
                'side',
                'line',
                'plus_style',
                'period',
                'game_date',
                'odds',
              ],
              properties: {
                text: {
                  type: 'string',
                  description:
                    'The leg as printed (selection and market), e.g. "Saquon Barkley Over 84.5 Rushing Yards". No odds, pick amount, payout, balance, username, or bet ID.',
                },
                market: { type: 'string', enum: [...SLIP_MARKETS] },
                stat: {
                  ...nullable({ type: 'string', enum: [...STAT_KEYS] }),
                  description: 'For PLAYER_STAT only: which stat. ANY_TD is a count of touchdowns.',
                },
                player: {
                  ...nullable({ type: 'string' }),
                  description: 'Player name exactly as printed, for player markets.',
                },
                team: {
                  ...nullable({ type: 'string' }),
                  description:
                    'The team the pick is on, from printed text, the logo or jersey beside the leg, or the matchup line (name, city, or abbreviation). Prefer printed text over a conflicting logo. Null only when unclear or for game totals.',
                },
                matchup: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'The teams in the game as printed for this leg, e.g. ["PHI", "CHI"].',
                },
                side: {
                  ...nullable({ type: 'string', enum: [...SLIP_SIDES] }),
                  description:
                    "OVER/UNDER for lines (MORE/HIGHER = OVER, LESS/LOWER = UNDER). On pick'em screens use the highlighted arrow: up = OVER, down = UNDER; the other arrow is unselected. Null when no side is shown; never guess. YES/NO for touchdown scorer markets.",
                },
                line: {
                  ...nullable({ type: 'number' }),
                  description:
                    'The number as printed. Spreads keep their sign from the picked team (e.g. -3.5). Never the odds.',
                },
                plus_style: {
                  type: 'boolean',
                  description:
                    'True when the line is printed as "N+" (e.g. "60+ receiving yards").',
                },
                period: { type: 'string', enum: [...SLIP_PERIODS] },
                game_date: {
                  ...nullable({ type: 'string' }),
                  description: 'Game date as YYYY-MM-DD when the slip prints one, else null.',
                },
                odds: {
                  ...nullable({ type: 'string' }),
                  description: 'Odds as printed, e.g. "-110".',
                },
              },
            },
          },
        },
      },
    },
  },
};
