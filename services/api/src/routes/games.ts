import { rankBroadcasts, type GameBroadcastOption } from '@roster-remote/dispatcher';
import type { GameState } from '@roster-remote/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { deriveDisplayPhaseNow, derivePhaseOpeners } from '../lib/phase-openers.js';
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

/** Abbreviation of the possessing team, or null — same rule as `flag_event` `new_state.possession_team`. */
function possessionTeamAbbreviation(
  gameState: GameState,
  home: TeamDisplay | undefined,
  away: TeamDisplay | undefined,
): string | null {
  if (!gameState.possessionTeamId) return null;
  if (gameState.possessionTeamId === gameState.homeTeamId) return home?.abbreviation ?? null;
  if (gameState.possessionTeamId === gameState.awayTeamId) return away?.abbreviation ?? null;
  return null;
}

function toWireBroadcasts(broadcasts: GameBroadcastOption[], subscribedServices: Set<string>) {
  // Eligibility-first BroadcastResolver (`rankBroadcasts`) — presentation ranking for the schedule
  // menu. NOT `pickBroadcastSource` (timing / lag-only among subscribed services).
  return rankBroadcasts(broadcasts, subscribedServices).map((b) => ({
    service: b.service,
    deep_link_url: b.deepLinkUrl,
    requires_subscription: b.requiresSubscription,
    user_has_subscription: b.userHasSubscription,
    typical_lag_seconds: b.typicalLagSeconds,
    preferred: b.preferred,
  }));
}

const gamesRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * PLAN.md Section 9 `GET /games?week={w}` (Sprint 10) — week's schedule with per-game ranked
   * broadcasts. Home supplies `week` from `GET /state/nfl`. One `user_app_presence` load is reused
   * across the whole slate; each game is ranked via `rankBroadcasts` (BroadcastResolver).
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

      const [teamsResult, broadcastsResult, presenceResult] = await Promise.all([
        fastify.supabase
          .from('teams')
          .select('id, abbreviation, name, primary_color, secondary_color')
          .in('id', teamIds),
        fastify.supabase
          .from('game_broadcasts')
          .select('game_id, service, deep_link_url, requires_subscription')
          .in('game_id', gameIds),
        // ONE presence load for the whole week — not per game.
        fastify.supabase
          .from('user_app_presence')
          .select('service, has_subscription')
          .eq('user_id', user.id),
      ]);
      if (teamsResult.error) throw teamsResult.error;
      if (broadcastsResult.error) throw broadcastsResult.error;
      if (presenceResult.error) throw presenceResult.error;

      const teamById = new Map((teamsResult.data ?? []).map((t) => [t.id, t]));
      const broadcastsByGameId = new Map<string, GameBroadcastOption[]>();
      for (const row of broadcastsResult.data ?? []) {
        const list = broadcastsByGameId.get(row.game_id) ?? [];
        list.push({
          service: row.service,
          deepLinkUrl: row.deep_link_url,
          requiresSubscription: row.requires_subscription,
        });
        broadcastsByGameId.set(row.game_id, list);
      }

      const subscribedServices = new Set(
        (presenceResult.data ?? [])
          .filter((row) => row.has_subscription)
          .map((row) => row.service),
      );

      return {
        week,
        games: games.map((game) => {
          const home = teamById.get(game.home_team_id);
          const away = teamById.get(game.away_team_id);
          return {
            game_id: game.id,
            status: game.status,
            scheduled_start: game.scheduled_start,
            ...teamFields(home, away),
            broadcasts: toWireBroadcasts(broadcastsByGameId.get(game.id) ?? [], subscribedServices),
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
    }> = [];

    for (const game of candidates) {
      const gameState = await fastify.gameStateStore.getGameState(game.id);
      // Omit-not-degrade: no Redis state → skip. Never invent 0–0 / Q0.
      if (!gameState) continue;

      const home = teamById.get(game.home_team_id);
      const away = teamById.get(game.away_team_id);
      liveGames.push({
        game_id: game.id,
        status: 'in_progress',
        scheduled_start: game.scheduled_start,
        ...teamFields(home, away),
        score: { home: gameState.scoreHome, away: gameState.scoreAway },
        quarter: gameState.quarter,
        time_remaining_sec: gameState.timeRemainingSec,
        possession_team: possessionTeamAbbreviation(gameState, home, away),
      });
    }

    return { games: liveGames };
  });

  /**
   * PLAN.md Section 9 `GET /games/:id/broadcasts` — the game's broadcast sources annotated by the
   * caller's app presence. Presentation only (the full ranked list), so it uses `rankBroadcasts`
   * directly (Section 2's `BroadcastResolver`); it is NOT the timing-critical switch recommendation
   * (that's `delivery.ts`, kept consistent with the fire-time source). Follows the `flags.ts`/
   * `session.ts` pattern: Supabase I/O here, pure ranking in the dispatcher package.
   *
   * `user_has_subscription` is derived from `user_app_presence.has_subscription = true` (a presence
   * row with `has_subscription = false` means the user knows about the service but can't watch it, so
   * it does not make a paid broadcast eligible).
   */
  fastify.get(
    '/games/:id/broadcasts',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const user = requireUser(request);
      const { id: gameId } = request.params;

      const { data: game, error: gameError } = await fastify.supabase
        .from('games')
        .select('id')
        .eq('id', gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (!game) {
        throw new ApiError(404, 'game_not_found', 'No game exists with that id.');
      }

      const { data: broadcastRows, error: broadcastsError } = await fastify.supabase
        .from('game_broadcasts')
        .select('service, deep_link_url, requires_subscription')
        .eq('game_id', gameId);
      if (broadcastsError) throw broadcastsError;

      const { data: presenceRows, error: presenceError } = await fastify.supabase
        .from('user_app_presence')
        .select('service, has_subscription')
        .eq('user_id', user.id);
      if (presenceError) throw presenceError;

      const subscribedServices = new Set(
        (presenceRows ?? []).filter((row) => row.has_subscription).map((row) => row.service),
      );

      const broadcasts: GameBroadcastOption[] = (broadcastRows ?? []).map((row) => ({
        service: row.service,
        deepLinkUrl: row.deep_link_url,
        requiresSubscription: row.requires_subscription,
      }));

      return {
        game_id: gameId,
        broadcasts: toWireBroadcasts(broadcasts, subscribedServices),
      };
    },
  );
};

export default gamesRoutes;
