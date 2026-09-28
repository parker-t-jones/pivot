import { buildGameSummary } from '@pivot/dispatcher';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { deriveDisplayPhaseNow, derivePhaseOpeners } from '../lib/phase-openers.js';
import { buildWeekWatch } from '../lib/watchOptions.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

interface TeamDisplay {
  abbreviation: string;
  name: string;
  primary_color: string;
  secondary_color: string;
}

function teamFields(home: TeamDisplay | undefined, away: TeamDisplay | undefined) {
  return {
    home_team: home?.abbreviation ?? '',
    away_team: away?.abbreviation ?? '',
    home_team_name: home?.name ?? '',
    away_team_name: away?.name ?? '',
    home_team_primary_color: home?.primary_color ?? '',
    home_team_secondary_color: home?.secondary_color ?? '',
    away_team_primary_color: away?.primary_color ?? '',
    away_team_secondary_color: away?.secondary_color ?? '',
  };
}

const AIRING_COLUMNS = 'game_id, network, market, espn_media_name, espn_type';

function subscribedServicesFrom(rows: { service: string; has_subscription: boolean }[] | null) {
  return new Set((rows ?? []).filter((row) => row.has_subscription).map((row) => row.service));
}

const gamesRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * PLAN.md Section 9 `GET /games?week={w}` (Sprint 10) — week's schedule with per-game watch
   * options and airings (`buildWeekWatch`, docs/B1-BROADCAST-DESIGN.md §1.6). Home supplies `week`
   * from `GET /state/nfl`. One `user_app_presence` load is reused across the whole slate.
   */
  fastify.get(
    '/games',
    {
      schema: {
        querystring: z.object({
          week: z.coerce.number().int().min(0),
        }),
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { week } = request.query;

      // Scope week slate by schedule-derived display_phase (not Sleeper season_type, which runs
      // ahead of actual games). During 'off' there is no active phase slate — return empty.
      const nflState = await getCurrentNflState(fastify.lineupCache);
      const openers = await derivePhaseOpeners(fastify.supabase);
      const displayPhase = deriveDisplayPhaseNow(openers, nflState.seasonType);
      if (displayPhase === 'off') {
        return { week, games: [] };
      }
      const seasonType =
        displayPhase === 'post' ? 'post' : displayPhase === 'pre' ? 'pre' : 'regular';

      const { data: gameRows, error: gamesError } = await fastify.supabase
        .from('games')
        .select('id, status, scheduled_start, home_team_id, away_team_id')
        .eq('week', week)
        .eq('season_type', seasonType)
        .order('scheduled_start', { ascending: true });
      if (gamesError) throw gamesError;
      const games = gameRows ?? [];

      if (games.length === 0) {
        return { week, games: [] };
      }

      const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
      const gameIds = games.map((g) => g.id);

      const [teamsResult, airingsResult, presenceResult] = await Promise.all([
        fastify.supabase
          .from('teams')
          .select('id, abbreviation, name, primary_color, secondary_color')
          .in('id', teamIds),
        fastify.supabase.from('game_airings').select(AIRING_COLUMNS).in('game_id', gameIds),
        // ONE presence load for the whole week — not per game.
        fastify.supabase
          .from('user_app_presence')
          .select('service, has_subscription')
          .eq('user_id', user.id),
      ]);
      if (teamsResult.error) throw teamsResult.error;
      if (airingsResult.error) throw airingsResult.error;
      if (presenceResult.error) throw presenceResult.error;

      const teamById = new Map((teamsResult.data ?? []).map((t) => [t.id, t]));
      const watchByGameId = buildWeekWatch(
        games,
        airingsResult.data ?? [],
        subscribedServicesFrom(presenceResult.data),
      );

      return {
        week,
        games: games.map((game) => {
          const home = teamById.get(game.home_team_id);
          const away = teamById.get(game.away_team_id);
          const watch = watchByGameId.get(game.id);
          return {
            game_id: game.id,
            status: game.status,
            scheduled_start: game.scheduled_start,
            ...teamFields(home, away),
            broadcasts: watch?.broadcasts ?? [],
            airings: watch?.airings ?? [],
          };
        }),
      };
    },
  );

  /**
   * PLAN.md Section 9 `GET /games/live` (Sprint 10) — in-progress games hydrated from Redis
   * `game_state`. Omit (do not degrade) any DB `in_progress` row with no Redis live-state — a wrong
   * zero-score claim is worse than absence in a spoiler-safe app. No broadcasts (use
   * `GET /games/:id/broadcasts` when switching).
   *
   * Registered before `/games/:id/broadcasts` so `live` is never treated as an `:id`.
   */
  fastify.get('/games/live', async (request) => {
    requireUser(request);

    const { data: gameRows, error: gamesError } = await fastify.supabase
      .from('games')
      .select('id, status, scheduled_start, home_team_id, away_team_id')
      .eq('status', 'in_progress')
      .order('scheduled_start', { ascending: true });
    if (gamesError) throw gamesError;
    const candidates = gameRows ?? [];

    if (candidates.length === 0) {
      return { games: [] };
    }

    const teamIds = [...new Set(candidates.flatMap((g) => [g.home_team_id, g.away_team_id]))];
    const { data: teamRows, error: teamsError } = await fastify.supabase
      .from('teams')
      .select('id, abbreviation, name, primary_color, secondary_color')
      .in('id', teamIds);
    if (teamsError) throw teamsError;
    const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]));

    const liveGames: Array<{
      game_id: string;
      status: 'in_progress';
      scheduled_start: string;
      home_team: string;
      away_team: string;
      home_team_name: string;
      away_team_name: string;
      home_team_primary_color: string;
      home_team_secondary_color: string;
      away_team_primary_color: string;
      away_team_secondary_color: string;
      score: { home: number; away: number };
      quarter: number;
      time_remaining_sec: number;
      possession_team: string | null;
      yards_to_endzone: number | null;
      down: number | null;
      distance: number | null;
      in_red_zone: boolean;
    }> = [];

    for (const game of candidates) {
      const gameState = await fastify.gameStateStore.getGameState(game.id);
      // Omit-not-degrade: no Redis state → skip. Never invent 0–0 / Q0.
      if (!gameState) continue;

      const home = teamById.get(game.home_team_id);
      const away = teamById.get(game.away_team_id);
      const summary = buildGameSummary(gameState, {
        homeTeamAbbreviation: home?.abbreviation ?? '',
        awayTeamAbbreviation: away?.abbreviation ?? '',
        homeTeamName: home?.name ?? '',
        awayTeamName: away?.name ?? '',
        homeTeamPrimaryColor: home?.primary_color ?? '',
        homeTeamSecondaryColor: home?.secondary_color ?? '',
        awayTeamPrimaryColor: away?.primary_color ?? '',
        awayTeamSecondaryColor: away?.secondary_color ?? '',
      });
      liveGames.push({
        game_id: game.id,
        status: 'in_progress',
        scheduled_start: game.scheduled_start,
        ...summary,
      });
    }

    return { games: liveGames };
  });

  /**
   * PLAN.md Section 9 `GET /games/:id/broadcasts` — the game's watch options for the caller: the
   * same `buildWeekWatch` path as `GET /games?week=`, so regional-slate ranking sees the game's
   * whole week. Presentation only; NOT the timing-critical switch recommendation (that's
   * `delivery.ts`).
   *
   * A service counts only when `user_app_presence.has_subscription = true` (a presence row with
   * `has_subscription = false` means the user knows about the service but can't watch it).
   */
  fastify.get(
    '/games/:id/broadcasts',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const user = requireUser(request);
      const { id: gameId } = request.params;

      const { data: game, error: gameError } = await fastify.supabase
        .from('games')
        .select('id, week, season_type')
        .eq('id', gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) {
        throw new ApiError(404, 'game_not_found', 'No game exists with that id.');
      }

      const { data: weekGames, error: weekError } = await fastify.supabase
        .from('games')
        .select('id, scheduled_start')
        .eq('week', game.week)
        .eq('season_type', game.season_type)
        .order('scheduled_start', { ascending: true });
      if (weekError) throw weekError;
      const slate = weekGames ?? [];

      const [airingsResult, presenceResult] = await Promise.all([
        fastify.supabase
          .from('game_airings')
          .select(AIRING_COLUMNS)
          .in('game_id', slate.map((g) => g.id)),
        fastify.supabase
          .from('user_app_presence')
          .select('service, has_subscription')
          .eq('user_id', user.id),
      ]);
      if (airingsResult.error) throw airingsResult.error;
      if (presenceResult.error) throw presenceResult.error;

      const watch = buildWeekWatch(
        slate,
        airingsResult.data ?? [],
        subscribedServicesFrom(presenceResult.data),
      ).get(gameId);

      return {
        game_id: gameId,
        broadcasts: watch?.broadcasts ?? [],
      };
    },
  );
};

export default gamesRoutes;
