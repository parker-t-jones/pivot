import type { Json } from '../lib/database.types.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

const STAKE_TYPES = ['SPREAD', 'TOTAL_OVER', 'TOTAL_UNDER', 'MONEYLINE', 'SURVIVOR'] as const;
type ManualStakeType = (typeof STAKE_TYPES)[number];

const TEAM_TYPES = new Set<ManualStakeType>(['SPREAD', 'MONEYLINE', 'SURVIVOR']);
const TOTAL_TYPES = new Set<ManualStakeType>(['TOTAL_OVER', 'TOTAL_UNDER']);
const FANTASY_TYPES = new Set(['ROSTERED', 'OPPONENT_ROSTERED']);

const postBody = z.object({
  type: z.enum(STAKE_TYPES),
  gameId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  line: z.number().finite().optional(),
});

const weekQuery = z.object({
  week: z.coerce.number().int().min(0).optional(),
});

interface GameRow {
  id: string;
  season_year: number;
  week: number;
  season_type: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_start: string;
}

interface TeamRow {
  id: string;
  abbreviation: string;
  name: string;
}

interface StakeRow {
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
}

function conditionType(condition: Json): string | null {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const type = condition['type'];
  return typeof type === 'string' ? type : null;
}

function conditionLine(condition: Json): number | null {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const line = condition['line'];
  return typeof line === 'number' ? line : null;
}

function isHalfPoint(line: number): boolean {
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-6;
}

function lineError(type: ManualStakeType, line: number | undefined): boolean {
  if (type === 'MONEYLINE' || type === 'SURVIVOR') return line !== undefined;
  if (line === undefined || !isHalfPoint(line)) return true;
  if (type === 'SPREAD') return Math.abs(line) > 50;
  return line < 10 || line > 100;
}

function subjectsMatch(stored: Json, next: Json): boolean {
  return JSON.stringify(stored) === JSON.stringify(next);
}

function sameStake(
  row: StakeRow,
  type: ManualStakeType,
  subject: Json,
  line: number | undefined,
): boolean {
  if (conditionType(row.condition) !== type) return false;
  if (!subjectsMatch(row.subject, subject)) return false;
  return conditionLine(row.condition) === (line ?? null);
}

function stakeResponse(row: StakeRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    season: row.season,
    week: row.week,
    game_id: row.game_id,
    subject: row.subject,
    condition: row.condition,
    source: row.source,
    weight: row.weight,
    created_at: row.created_at,
  };
}

/** Manual spread, total, moneyline, and survivor stakes. Fantasy rows stay on sync. */
const stakesRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/stakes', { schema: { body: postBody } }, async (request) => {
    const user = requireUser(request);
    const { type, gameId, teamId, line } = request.body;
    const nfl = await getCurrentNflState(fastify.lineupCache);
    const season = Number(nfl.season);
    if (!Number.isInteger(season)) {
      throw new ApiError(400, 'stake_game_invalid', 'That game is not open for a bet.');
    }

    const { data: game, error: gameError } = await fastify.supabase
      .from('games')
      .select(
        'id, season_year, week, season_type, status, home_team_id, away_team_id, scheduled_start',
      )
      .eq('id', gameId)
      .maybeSingle();
    if (gameError) throw gameError;
    const row = game as GameRow | null;
    if (
      row === null ||
      row.season_year !== season ||
      row.season_type !== 'regular' ||
      row.status === 'final'
    ) {
      throw new ApiError(400, 'stake_game_invalid', 'That game is not open for a bet.');
    }

    if (TEAM_TYPES.has(type)) {
      if (teamId === undefined || (teamId !== row.home_team_id && teamId !== row.away_team_id)) {
        throw new ApiError(400, 'stake_team_invalid', 'Pick a team in that game.');
      }
    }
    if (lineError(type, line)) {
      throw new ApiError(400, 'stake_line_invalid', 'That line is not valid.');
    }

    const subject: Json = TOTAL_TYPES.has(type)
      ? { type: 'GAME', gameId }
      : { type: 'TEAM', teamId: teamId ?? '' };
    const condition: Json =
      type === 'MONEYLINE'
        ? { type: 'MONEYLINE', side: 'TEAM' }
        : type === 'SURVIVOR'
          ? { type: 'SURVIVOR' }
          : { type, line: line ?? 0 };

    const { data: existing, error: existingError } = await fastify.supabase
      .from('stakes')
      .select('id, user_id, season, week, game_id, subject, condition, source, weight, created_at')
      .eq('user_id', user.id)
      .eq('season', row.season_year)
      .eq('week', row.week);
    if (existingError) throw existingError;
    const owned = (existing ?? []) as StakeRow[];

    if (
      type === 'SURVIVOR' &&
      owned.some((stake) => conditionType(stake.condition) === 'SURVIVOR')
    ) {
      throw new ApiError(
        409,
        'survivor_pick_exists',
        'A survivor pick already exists for this week.',
      );
    }
    if (owned.some((stake) => sameStake(stake, type, subject, line))) {
      throw new ApiError(409, 'stake_duplicate', 'That stake already exists.');
    }

    const { data: created, error: insertError } = await fastify.supabase
      .from('stakes')
      .insert({
        user_id: user.id,
        season: row.season_year,
        week: row.week,
        game_id: row.id,
        subject,
        condition,
        source: 'MANUAL',
        weight: 1,
      })
      .select('id, user_id, season, week, game_id, subject, condition, source, weight, created_at')
      .single();
    if (insertError) throw insertError;

    return { stake: stakeResponse(created as StakeRow) };
  });

  fastify.get('/stakes', { schema: { querystring: weekQuery } }, async (request) => {
    const user = requireUser(request);
    const nfl = await getCurrentNflState(fastify.lineupCache);
    const season = Number(nfl.season);
    const week = request.query.week ?? nfl.week;

    const { data, error } = await fastify.supabase
      .from('stakes')
      .select('id, user_id, season, week, game_id, subject, condition, source, weight, created_at')
      .eq('user_id', user.id)
      .eq('season', season)
      .eq('week', week);
    if (error) throw error;

    const stakes = ((data ?? []) as StakeRow[])
      .filter((stake) => !FANTASY_TYPES.has(conditionType(stake.condition) ?? ''))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    const gameIds = [...new Set(stakes.map((stake) => stake.game_id))];
    const gamesById = new Map<string, GameRow>();
    const teamsById = new Map<string, TeamRow>();
    if (gameIds.length > 0) {
      const { data: games, error: gamesError } = await fastify.supabase
        .from('games')
        .select(
          'id, season_year, week, season_type, status, home_team_id, away_team_id, scheduled_start',
        )
        .in('id', gameIds);
      if (gamesError) throw gamesError;
      for (const game of (games ?? []) as GameRow[]) gamesById.set(game.id, game);

      const teamIds = [
        ...new Set(
          [...gamesById.values()].flatMap((game) => [game.home_team_id, game.away_team_id]),
        ),
      ];
      if (teamIds.length > 0) {
        const { data: teams, error: teamsError } = await fastify.supabase
          .from('teams')
          .select('id, abbreviation, name')
          .in('id', teamIds);
        if (teamsError) throw teamsError;
        for (const team of (teams ?? []) as TeamRow[]) teamsById.set(team.id, team);
      }
    }

    return {
      week,
      stakes: stakes.map((stake) => {
        const game = gamesById.get(stake.game_id);
        const home = game ? teamsById.get(game.home_team_id) : undefined;
        const away = game ? teamsById.get(game.away_team_id) : undefined;
        return {
          ...stakeResponse(stake),
          game: game
            ? {
                scheduled_start: game.scheduled_start,
                status: game.status,
                home_team_id: game.home_team_id,
                away_team_id: game.away_team_id,
                home_team: home?.abbreviation ?? '',
                away_team: away?.abbreviation ?? '',
                home_team_name: home?.name ?? '',
                away_team_name: away?.name ?? '',
              }
            : null,
        };
      }),
    };
  });

  fastify.delete(
    '/stakes/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const user = requireUser(request);
      const { data, error } = await fastify.supabase
        .from('stakes')
        .select(
          'id, user_id, season, week, game_id, subject, condition, source, weight, created_at',
        )
        .eq('id', request.params.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      const stake = data as StakeRow | null;
      if (stake === null) {
        throw new ApiError(404, 'stake_not_found', 'Stake not found.');
      }
      const type = conditionType(stake.condition);
      if (type !== null && FANTASY_TYPES.has(type)) {
        throw new ApiError(403, 'stake_managed_by_sync', 'This stake is managed by league sync.');
      }

      const { error: deleteError } = await fastify.supabase
        .from('stakes')
        .delete()
        .eq('id', stake.id)
        .eq('user_id', user.id);
      if (deleteError) throw deleteError;
      return reply.status(204).send();
    },
  );
};

export default stakesRoutes;
