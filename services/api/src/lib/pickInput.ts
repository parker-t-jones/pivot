import { STAT_LINE_RANGE, type StakeCondition } from '@pivot/shared';
import { z } from 'zod';
import type { Json } from './database.types.js';
import { ApiError } from './errors.js';
import { stakeConditionSchema } from './pickRows.js';
import type { SupabaseServiceClient } from './supabase.js';

/** One pick in a `POST /picks` body: a game, a condition, and the team or player it is on. */
export const pickInputSchema = z.object({
  gameId: z.string().uuid(),
  condition: stakeConditionSchema,
  teamId: z.string().uuid().optional(),
  playerId: z.string().uuid().optional(),
});

export type PickInput = z.infer<typeof pickInputSchema>;

export const MIN_SLIP_LEGS = 2;
export const MAX_SLIP_LEGS = 12;

export const postPicksBodySchema = z.union([
  z.object({ pick: pickInputSchema }).strict(),
  z.object({ legs: z.array(pickInputSchema).min(MIN_SLIP_LEGS).max(MAX_SLIP_LEGS) }).strict(),
]);

export interface PickGameRow {
  id: string;
  season_year: number;
  week: number;
  season_type: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_start: string;
}

export const PICK_GAME_COLUMNS =
  'id, season_year, week, season_type, status, home_team_id, away_team_id, scheduled_start';

/** A validated pick, ready to insert. */
export interface ValidatedPick {
  game: PickGameRow;
  subject: Json;
  condition: Json;
}

type BetCondition = Exclude<StakeCondition, { type: 'ROSTERED' } | { type: 'OPPONENT_ROSTERED' }>;

const PLAYER_TYPES = new Set(['STAT_OVER', 'STAT_UNDER', 'PLAYER_EVENT']);
const TEAM_TYPES = new Set([
  'SPREAD',
  'MONEYLINE',
  'SURVIVOR',
  'TEAM_TOTAL_OVER',
  'TEAM_TOTAL_UNDER',
  'FIRST_TO_SCORE',
]);
const GAME_TYPES = new Set(['TOTAL_OVER', 'TOTAL_UNDER']);
/** FG totals are on one team with a teamId, or on the whole game without one. */
const TEAM_OR_GAME_TYPES = new Set(['FG_OVER', 'FG_UNDER']);

function isHalfPoint(line: number): boolean {
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-6;
}

function inRange(line: number, min: number, max: number): boolean {
  return isHalfPoint(line) && line >= min && line <= max;
}

/** Lines are multiples of 0.5 inside a per-type range. The full-game spread and total keep #3's ranges. */
export function lineIsValid(condition: BetCondition): boolean {
  switch (condition.type) {
    case 'SPREAD':
      return isHalfPoint(condition.line) && Math.abs(condition.line) <= 50;
    case 'TOTAL_OVER':
    case 'TOTAL_UNDER':
      return condition.segment === undefined
        ? inRange(condition.line, 10, 100)
        : inRange(condition.line, 0.5, 70);
    case 'TEAM_TOTAL_OVER':
    case 'TEAM_TOTAL_UNDER':
      return inRange(condition.line, 0.5, 70);
    case 'FG_OVER':
    case 'FG_UNDER':
      return inRange(condition.line, 0.5, 10);
    case 'STAT_OVER':
    case 'STAT_UNDER': {
      const range = STAT_LINE_RANGE[condition.stat];
      return inRange(condition.line, range.min, range.max);
    }
    default:
      return true;
  }
}

function invalidGame(): ApiError {
  return new ApiError(400, 'stake_game_invalid', 'That game is not open for a pick.');
}

/**
 * Checks one pick against its game, team, and player (docs/P2-PICKS-MODEL.md §7). Live games are
 * open (live bets); final games are not. The pick is never checked against the current game
 * state: refusing an "already cleared" line would reveal that it has.
 */
export async function validatePick(
  supabase: SupabaseServiceClient,
  input: PickInput,
  season: number,
): Promise<ValidatedPick> {
  const condition = input.condition as StakeCondition;
  if (condition.type === 'ROSTERED' || condition.type === 'OPPONENT_ROSTERED') {
    throw new ApiError(400, 'stake_type_invalid', 'That pick type cannot be added here.');
  }

  const { data, error } = await supabase
    .from('games')
    .select(PICK_GAME_COLUMNS)
    .eq('id', input.gameId)
    .maybeSingle();
  if (error) throw error;
  const game = data as PickGameRow | null;
  if (
    game === null ||
    game.season_year !== season ||
    game.season_type !== 'regular' ||
    game.status === 'final'
  ) {
    throw invalidGame();
  }

  if (!lineIsValid(condition)) {
    throw new ApiError(400, 'stake_line_invalid', 'That line is not valid.');
  }

  const inGame = (teamId: string | undefined): teamId is string =>
    teamId !== undefined && (teamId === game.home_team_id || teamId === game.away_team_id);

  let subject: Json;
  if (PLAYER_TYPES.has(condition.type)) {
    if (input.playerId === undefined) {
      throw new ApiError(400, 'stake_player_invalid', 'Pick a player in that game.');
    }
    const { data: playerRow, error: playerError } = await supabase
      .from('players')
      .select('id, team_id, active')
      .eq('id', input.playerId)
      .maybeSingle();
    if (playerError) throw playerError;
    const player = playerRow as { id: string; team_id: string; active: boolean } | null;
    if (player === null || !player.active || !inGame(player.team_id)) {
      throw new ApiError(400, 'stake_player_invalid', 'Pick a player in that game.');
    }
    subject = { type: 'PLAYER', playerId: player.id, teamId: player.team_id };
  } else if (TEAM_TYPES.has(condition.type)) {
    if (!inGame(input.teamId)) {
      throw new ApiError(400, 'stake_team_invalid', 'Pick a team in that game.');
    }
    subject = { type: 'TEAM', teamId: input.teamId };
  } else if (GAME_TYPES.has(condition.type)) {
    subject = { type: 'GAME', gameId: game.id };
  } else if (TEAM_OR_GAME_TYPES.has(condition.type)) {
    if (input.teamId !== undefined && !inGame(input.teamId)) {
      throw new ApiError(400, 'stake_team_invalid', 'Pick a team in that game.');
    }
    subject =
      input.teamId === undefined
        ? { type: 'GAME', gameId: game.id }
        : { type: 'TEAM', teamId: input.teamId };
  } else {
    throw new ApiError(400, 'stake_type_invalid', 'That pick type cannot be added here.');
  }

  return { game, subject, condition: canonicalCondition(condition) };
}

/** Stored condition with keys in a fixed order and no undefined segment, for duplicate checks. */
export function canonicalCondition(condition: StakeCondition): Json {
  const entries = Object.entries(condition)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as Json;
}

/** Same pick: same subject and same condition, field by field. */
export function samePick(
  a: { subject: Json; condition: Json },
  b: { subject: Json; condition: Json },
): boolean {
  return (
    canonicalJson(a.subject) === canonicalJson(b.subject) &&
    canonicalJson(a.condition) === canonicalJson(b.condition)
  );
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`).join(',')}}`;
}
