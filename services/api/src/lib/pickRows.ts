import type { Stake } from '@pivot/engine';
import { SEGMENTS, STAT_KEYS, type StakeCondition } from '@pivot/shared';
import { z } from 'zod';
import type { Json } from './database.types.js';

/**
 * One parser for `stakes` rows (docs/P2-PICKS-MODEL.md §8), shared by the bet pass, `/flags/current`
 * bet chips, settlement, and the picks routes.
 */

const line = z.number().finite();
const segment = z.enum(SEGMENTS as [string, ...string[]]).optional();
const stat = z.enum(STAT_KEYS as [string, ...string[]]);

export const stakeConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROSTERED') }),
  z.object({ type: z.literal('OPPONENT_ROSTERED') }),
  z.object({ type: z.literal('STAT_OVER'), stat, line }),
  z.object({ type: z.literal('STAT_UNDER'), stat, line }),
  z.object({
    type: z.literal('PLAYER_EVENT'),
    event: z.enum(['ANY_TD', 'FIRST_TD']),
    side: z.enum(['YES', 'NO']),
  }),
  z.object({ type: z.literal('MONEYLINE'), side: z.literal('TEAM') }),
  z.object({ type: z.literal('SPREAD'), line, segment }),
  z.object({ type: z.literal('TOTAL_OVER'), line, segment }),
  z.object({ type: z.literal('TOTAL_UNDER'), line, segment }),
  z.object({ type: z.literal('TEAM_TOTAL_OVER'), line, segment }),
  z.object({ type: z.literal('TEAM_TOTAL_UNDER'), line, segment }),
  z.object({ type: z.literal('FIRST_TO_SCORE') }),
  z.object({ type: z.literal('FG_OVER'), line, segment }),
  z.object({ type: z.literal('FG_UNDER'), line, segment }),
  z.object({ type: z.literal('SURVIVOR') }),
]);

export const FANTASY_CONDITION_TYPES: ReadonlySet<string> = new Set([
  'ROSTERED',
  'OPPONENT_ROSTERED',
]);

/** The four types that existed before #10. Old app builds can only label these. */
const LEGACY_BET_TYPES: ReadonlySet<string> = new Set([
  'SPREAD',
  'TOTAL_OVER',
  'TOTAL_UNDER',
  'MONEYLINE',
  'SURVIVOR',
]);

const STAKE_SOURCES = new Set<Stake['source']>([
  'SLEEPER_ROSTER',
  'SLEEPER_OPPONENT',
  'MANUAL',
  'KALSHI_MARKET',
  'SHARED_LIST',
]);

export function parseCondition(value: Json): StakeCondition | null {
  const parsed = stakeConditionSchema.safeParse(value);
  // zod's inferred enum types are `string`; the schema is built from the same unions.
  return parsed.success ? (parsed.data as StakeCondition) : null;
}

export function conditionTypeOf(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const type = value['type'];
  return typeof type === 'string' ? type : null;
}

const KNOWN_CONDITION_TYPES: ReadonlySet<string> = new Set(
  stakeConditionSchema.options.map((option) => option.shape.type.value),
);

/** Any known manual pick type: everything but fantasy rows. */
export function isBetConditionType(type: string | null): boolean {
  return type !== null && KNOWN_CONDITION_TYPES.has(type) && !FANTASY_CONDITION_TYPES.has(type);
}

export function parseSubject(value: Json, gameId: string): Stake['subject'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = value['type'];
  if (type === 'GAME') return { type: 'GAME', gameId };
  const teamId = value['teamId'];
  if (type === 'TEAM' && typeof teamId === 'string') return { type: 'TEAM', teamId };
  const playerId = value['playerId'];
  if (type === 'PLAYER' && typeof playerId === 'string' && typeof teamId === 'string') {
    return { type: 'PLAYER', playerId, teamId };
  }
  return null;
}

export interface StakeRowLike {
  id: string;
  user_id: string;
  season: number;
  week: number;
  game_id: string;
  subject: Json;
  condition: Json;
  source: string;
  weight: number;
  created_at: string;
  slip_id?: string | null;
}

export const STAKE_ROW_COLUMNS =
  'id, user_id, season, week, game_id, subject, condition, source, weight, created_at, slip_id';

export function toStake(row: StakeRowLike): Stake | null {
  if (!STAKE_SOURCES.has(row.source as Stake['source'])) return null;
  const subject = parseSubject(row.subject, row.game_id);
  const condition = parseCondition(row.condition);
  if (subject === null || condition === null) return null;
  return {
    id: row.id,
    userId: row.user_id,
    season: row.season,
    week: row.week,
    gameId: row.game_id,
    subject,
    condition,
    source: row.source as Stake['source'],
    weight: row.weight,
    createdAt: row.created_at,
    ...(row.slip_id ? { slipId: row.slip_id } : {}),
  };
}

/**
 * A row an old app build can show: one of the four pre-#10 types, full game, not a parlay leg,
 * not a player subject. `GET /stakes` returns only these.
 */
export function isLegacyPick(
  row: Pick<StakeRowLike, 'condition' | 'subject' | 'slip_id'>,
): boolean {
  if (row.slip_id) return false;
  const type = conditionTypeOf(row.condition);
  if (type === null || !LEGACY_BET_TYPES.has(type)) return false;
  const condition = row.condition as Record<string, Json>;
  if (condition['segment'] !== undefined && condition['segment'] !== null) return false;
  const subject = row.subject;
  if (typeof subject === 'object' && subject !== null && !Array.isArray(subject)) {
    if (subject['type'] === 'PLAYER') return false;
  }
  return true;
}
