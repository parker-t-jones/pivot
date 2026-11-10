import { pickProgress, slipSummary, type PropPlayer } from '@pivot/engine';
import type { GamePlayerStats, GameState, PickProgress, SettledResult } from '@pivot/shared';
import { formatPickLabel, shortPlayerName, type StakeTeam } from '@pivot/shared/stakeLabel';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { syncUserBetGames } from '../lib/betIndex.js';
import type { Json } from '../lib/database.types.js';
import { demoAccountFixed, userIsDemo } from '../lib/demoAccount.js';
import { demoStakesResponse } from '../lib/demoFixture.js';
import { ApiError, rethrowIfOwnAccountRowMissing } from '../lib/errors.js';
import {
  FREE_BET_LIMIT,
  countFreeSlots,
  countsTowardFreeCap,
  spentSlotIds,
} from '../lib/freeSlots.js';
import { gameHasKickedOff } from '../lib/kickoff.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import {
  PICK_GAME_COLUMNS,
  postPicksBodySchema,
  samePick,
  validatePick,
  type PickGameRow,
  type ValidatedPick,
} from '../lib/pickInput.js';
import {
  STAKE_ROW_COLUMNS,
  conditionTypeOf,
  isBetConditionType,
  toStake,
} from '../lib/pickRows.js';
import { loadPropPlayers } from '../lib/propPlayers.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

const weekQuery = z.object({
  week: z.coerce.number().int().min(0).optional(),
});

interface PickRow {
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
  slip_id: string | null;
  result: string | null;
  result_value: number | null;
}

interface SlipRow {
  id: string;
  user_id: string;
  season: number;
  week: number;
  created_at: string;
  result: string | null;
}

const PICK_COLUMNS = `${STAKE_ROW_COLUMNS}, result, result_value`;

function freeCapError(): ApiError {
  return new ApiError(
    403,
    'stake_limit_free',
    `Free accounts can track up to ${FREE_BET_LIMIT} picks a week. Upgrade to Pro for unlimited picks.`,
    { limit: FREE_BET_LIMIT },
  );
}

function sameWeek(picks: readonly ValidatedPick[]): boolean {
  const [first] = picks;
  return picks.every(
    (pick) =>
      pick.game.season_year === first?.game.season_year && pick.game.week === first.game.week,
  );
}

export interface PicksRoutesOptions {
  /** Clock for the kickoff check. Tests pin it. */
  now?: () => Date;
}

/**
 * Props, quarter and half lines, and parlays (docs/P2-PICKS-MODEL.md §7). `/stakes` stays the
 * old-client surface for the four pre-props types.
 */
const picksRoutes: FastifyPluginAsyncZod<PicksRoutesOptions> = async (fastify, opts) => {
  const now = opts.now ?? (() => new Date());
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const user = requireUser(request);
    if (await userIsDemo(fastify.supabase, user.id)) throw demoAccountFixed();
  });

  fastify.post('/picks', { schema: { body: postPicksBodySchema } }, async (request, reply) => {
    const user = requireUser(request);
    const nfl = await getCurrentNflState(fastify);
    const season = Number(nfl.season);
    if (!Number.isInteger(season)) {
      throw new ApiError(400, 'stake_game_invalid', 'That game is not open for a pick.');
    }

    const body = request.body;
    const inputs = 'pick' in body ? [body.pick] : body.legs;
    const isSlip = 'legs' in body;
    const picks: ValidatedPick[] = [];
    for (const input of inputs) picks.push(await validatePick(fastify.supabase, input, season));
    const [first] = picks;
    if (first === undefined) throw new ApiError(400, 'slip_legs_invalid', 'A parlay needs legs.');

    if (isSlip) {
      if (picks.some((pick) => conditionTypeOf(pick.condition) === 'SURVIVOR')) {
        throw new ApiError(400, 'slip_leg_invalid', 'A survivor pick cannot be a parlay leg.');
      }
      if (!sameWeek(picks)) {
        throw new ApiError(
          400,
          'slip_week_mismatch',
          'Every leg of a parlay must be in the same week.',
        );
      }
      if (
        picks.some((pick, index) => picks.slice(0, index).some((other) => samePick(pick, other)))
      ) {
        throw new ApiError(409, 'slip_duplicate_leg', 'That parlay has the same leg twice.');
      }
    }

    const season_year = first.game.season_year;
    const week = first.game.week;
    const { data: existing, error: existingError } = await fastify.supabase
      .from('stakes')
      .select(PICK_COLUMNS)
      .eq('user_id', user.id)
      .eq('season', season_year)
      .eq('week', week);
    if (existingError) throw existingError;
    const weekRows = (existing ?? []) as PickRow[];
    const singles = weekRows.filter(
      (row) => !row.slip_id && isBetConditionType(conditionTypeOf(row.condition)),
    );

    if (!isSlip) {
      if (
        conditionTypeOf(first.condition) === 'SURVIVOR' &&
        singles.some((row) => conditionTypeOf(row.condition) === 'SURVIVOR')
      ) {
        throw new ApiError(
          409,
          'survivor_pick_exists',
          'A survivor pick already exists for this week.',
        );
      }
      if (singles.some((row) => samePick(row, first))) {
        throw new ApiError(409, 'stake_duplicate', 'That pick already exists.');
      }
    }

    const usesSlot = isSlip || countsTowardFreeCap(first.condition);
    if (usesSlot) {
      const { data: userRow, error: userError } = await fastify.supabase
        .from('users')
        .select('subscription_tier')
        .eq('id', user.id)
        .single();
      if (userError) {
        rethrowIfOwnAccountRowMissing(userError);
        throw userError;
      }
      if (userRow.subscription_tier !== 'pro') {
        const { used } = countFreeSlots(
          weekRows,
          await spentSlotIds(fastify.supabase, user.id, season_year, week),
        );
        if (used >= FREE_BET_LIMIT) throw freeCapError();
      }
    }

    const rowFor = (pick: ValidatedPick, slipId: string | null) => ({
      user_id: user.id,
      season: pick.game.season_year,
      week: pick.game.week,
      game_id: pick.game.id,
      subject: pick.subject,
      condition: pick.condition,
      source: 'MANUAL',
      weight: 1,
      ...(slipId ? { slip_id: slipId } : {}),
    });

    if (!isSlip) {
      const { data: created, error: insertError } = await fastify.supabase
        .from('stakes')
        .insert(rowFor(first, null))
        .select(PICK_COLUMNS)
        .single();
      if (insertError) throw insertError;
      await fastify.lineupCache.addUserBet(first.game.id, user.id, week);
      return reply.status(201).send({ pick: pickBody(created as PickRow) });
    }

    const { data: slipData, error: slipError } = await fastify.supabase
      .from('pick_slips')
      .insert({ user_id: user.id, season: season_year, week })
      .select('id, user_id, season, week, created_at, result')
      .single();
    if (slipError) throw slipError;
    const slip = slipData as SlipRow;
    const { data: legData, error: legsError } = await fastify.supabase
      .from('stakes')
      .insert(picks.map((pick) => rowFor(pick, slip.id)))
      .select(PICK_COLUMNS);
    if (legsError) {
      // No transaction over REST: remove the empty slip so it never holds a slot.
      await fastify.supabase.from('pick_slips').delete().eq('id', slip.id);
      throw legsError;
    }
    for (const gameId of new Set(picks.map((pick) => pick.game.id))) {
      await fastify.lineupCache.addUserBet(gameId, user.id, week);
    }
    return reply.status(201).send({
      slip: {
        id: slip.id,
        season: slip.season,
        week: slip.week,
        created_at: slip.created_at,
        result: slip.result,
        legs: ((legData ?? []) as PickRow[]).map(pickBody),
      },
    });
  });

  fastify.get('/picks', { schema: { querystring: weekQuery } }, async (request) => {
    const user = requireUser(request);
    const nfl = await getCurrentNflState(fastify);
    const season = Number(nfl.season);
    const week = request.query.week ?? nfl.week;
    if (await userIsDemo(fastify.supabase, user.id)) {
      const demo = demoStakesResponse(user.id, Number.isInteger(season) ? season : 0, week, now());
      return {
        week,
        free_limit: FREE_BET_LIMIT,
        free_slots_used: 0,
        picks: demo.stakes.map((stake) => ({
          ...stake,
          slip_id: null,
          result: null,
          result_value: null,
          label: '',
          progress: { status: 'pending' } satisfies PickProgress,
        })),
        slips: [],
      };
    }

    const { data, error } = await fastify.supabase
      .from('stakes')
      .select(PICK_COLUMNS)
      .eq('user_id', user.id)
      .eq('season', season)
      .eq('week', week);
    if (error) throw error;
    const weekRows = (data ?? []) as PickRow[];
    const rows = weekRows
      .filter((row) => isBetConditionType(conditionTypeOf(row.condition)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const slots = countFreeSlots(
      weekRows,
      await spentSlotIds(fastify.supabase, user.id, season, week),
    );

    const slipIds = [...new Set(rows.flatMap((row) => (row.slip_id ? [row.slip_id] : [])))];
    const slipsById = new Map<string, SlipRow>();
    if (slipIds.length > 0) {
      const { data: slipData, error: slipError } = await fastify.supabase
        .from('pick_slips')
        .select('id, user_id, season, week, created_at, result')
        .in('id', slipIds);
      if (slipError) throw slipError;
      for (const slip of (slipData ?? []) as SlipRow[]) slipsById.set(slip.id, slip);
    }

    const gameIds = [...new Set(rows.map((row) => row.game_id))];
    const games = new Map<string, PickGameRow>();
    if (gameIds.length > 0) {
      const { data: gameData, error: gamesError } = await fastify.supabase
        .from('games')
        .select(PICK_GAME_COLUMNS)
        .in('id', gameIds);
      if (gamesError) throw gamesError;
      for (const game of (gameData ?? []) as PickGameRow[]) games.set(game.id, game);
    }
    const teamIds = [
      ...new Set([...games.values()].flatMap((g) => [g.home_team_id, g.away_team_id])),
    ];
    const teams: { id: string; abbreviation: string; name: string }[] = [];
    if (teamIds.length > 0) {
      const { data: teamData, error: teamsError } = await fastify.supabase
        .from('teams')
        .select('id, abbreviation, name')
        .in('id', teamIds);
      if (teamsError) throw teamsError;
      teams.push(...((teamData ?? []) as typeof teams));
    }
    const labelTeams: StakeTeam[] = teams.map((t) => ({
      teamId: t.id,
      abbreviation: t.abbreviation,
    }));
    const teamById = new Map(teams.map((t) => [t.id, t]));

    const stakes = rows.map((row) => ({ row, stake: toStake(row) }));
    const players = await loadPropPlayers(
      fastify.supabase,
      stakes.flatMap(({ stake }) =>
        stake?.subject.type === 'PLAYER' ? [stake.subject.playerId] : [],
      ),
    );

    // In-app progress reads the live state Home already shows, with no hold.
    const states = new Map<string, GameState | null>();
    const stats = new Map<string, GamePlayerStats | null>();
    for (const gameId of gameIds) {
      const game = games.get(gameId);
      const live =
        game?.status === 'in_progress' ? await fastify.gameStateStore.getGameState(gameId) : null;
      states.set(gameId, live);
      stats.set(gameId, live ? await fastify.readGamePlayerStats(gameId) : null);
    }

    const views = stakes.map(({ row, stake }) => {
      const player: PropPlayer | undefined =
        stake?.subject.type === 'PLAYER' ? players.get(stake.subject.playerId) : undefined;
      let progress: PickProgress = { status: 'pending' };
      if (row.result !== null) {
        progress = {
          status: row.result as SettledResult,
          ...(row.result_value !== null ? { current: row.result_value } : {}),
        };
      } else if (stake) {
        const live = states.get(row.game_id) ?? null;
        const liveStats = stats.get(row.game_id) ?? null;
        if (live) {
          progress = pickProgress(stake, {
            game: live,
            ...(liveStats ? { playerStats: liveStats } : {}),
            ...(player ? { player } : {}),
          });
        }
      }
      const game = games.get(row.game_id);
      const home = game ? teamById.get(game.home_team_id) : undefined;
      const away = game ? teamById.get(game.away_team_id) : undefined;
      return {
        ...pickBody(row),
        label: stake
          ? formatPickLabel(
              {
                condition: stake.condition,
                subject: {
                  type: stake.subject.type,
                  teamId: stake.subject.type === 'TEAM' ? stake.subject.teamId : null,
                },
                playerName: player ? shortPlayerName(player.firstName, player.lastName) : null,
              },
              labelTeams,
            )
          : '',
        player: player
          ? {
              id: player.playerId,
              first_name: player.firstName,
              last_name: player.lastName,
              team_id: player.teamId,
            }
          : null,
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
        progress,
      };
    });

    const slips = slipIds.flatMap((slipId) => {
      const slip = slipsById.get(slipId);
      if (!slip) return [];
      const legs = views.filter((view) => view.slip_id === slipId);
      const summary = slipSummary(legs.map((leg) => leg.progress));
      return [
        {
          id: slip.id,
          season: slip.season,
          week: slip.week,
          created_at: slip.created_at,
          result: slip.result,
          summary: slip.result ? { ...summary, status: slip.result as SettledResult } : summary,
          legs,
        },
      ];
    });

    return {
      week,
      free_limit: FREE_BET_LIMIT,
      free_slots_used: slots.used,
      picks: views.filter((view) => view.slip_id === null),
      slips: slips.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
  });

  fastify.delete(
    '/picks/slips/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const user = requireUser(request);
      const { data: slipData, error: slipError } = await fastify.supabase
        .from('pick_slips')
        .select('id, user_id, season, week, created_at, result')
        .eq('id', request.params.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (slipError) throw slipError;
      const slip = slipData as SlipRow | null;
      if (slip === null) throw new ApiError(404, 'slip_not_found', 'Parlay not found.');

      const { data: legData, error: legsError } = await fastify.supabase
        .from('stakes')
        .select('id, game_id')
        .eq('slip_id', slip.id);
      if (legsError) throw legsError;
      const legGameIds = [
        ...new Set(((legData ?? []) as { game_id: string }[]).map((leg) => leg.game_id)),
      ];

      // A slip that has kicked off keeps its slot spent. The spent row is written before the delete,
      // so a failed delete never refunds the slot and is never counted twice (live slip wins).
      if (legGameIds.length > 0) {
        const { data: gameData, error: gamesError } = await fastify.supabase
          .from('games')
          .select('id, status, scheduled_start')
          .in('id', legGameIds);
        if (gamesError) throw gamesError;
        const legGames = (
          (gameData ?? []) as { id: string; status: string; scheduled_start: string }[]
        ).sort(
          (a, b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.id.localeCompare(b.id),
        );
        const earliest = legGames[0];
        if (earliest && legGames.some((game) => gameHasKickedOff(game, now()))) {
          const { error: spentError } = await fastify.supabase.from('stake_spent_slots').upsert(
            {
              stake_id: slip.id,
              slot_kind: 'slip',
              user_id: user.id,
              season: slip.season,
              week: slip.week,
              game_id: earliest.id,
            },
            { onConflict: 'stake_id', ignoreDuplicates: true },
          );
          if (spentError) throw spentError;
        }
      }

      const { error: deleteError } = await fastify.supabase
        .from('pick_slips')
        .delete()
        .eq('id', slip.id)
        .eq('user_id', user.id);
      if (deleteError) throw deleteError;

      await syncUserBetGames(
        { supabase: fastify.supabase, lineupCache: fastify.lineupCache },
        user.id,
        slip.season,
        slip.week,
      );
      return reply.status(204).send();
    },
  );
};

function pickBody(row: PickRow) {
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
    slip_id: row.slip_id ?? null,
    result: row.result ?? null,
    result_value: row.result_value ?? null,
  };
}

export default picksRoutes;
