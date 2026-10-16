import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ApiError } from '../lib/errors.js';
import { parseGameLinkUrl } from '../lib/gameLink.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

const weekQuery = z.object({
  week: z.coerce.number().int().min(0).optional(),
});

const putBody = z.object({
  url: z.string(),
});

const gameParams = z.object({
  gameId: z.string().uuid(),
});

interface LinkRow {
  game_id: string;
  url: string;
  updated_at: string;
}

function linkResponse(row: LinkRow) {
  return {
    game_id: row.game_id,
    url: row.url,
    host: new URL(row.url).hostname,
    updated_at: row.updated_at,
  };
}

/** One saved stream URL per game for the signed-in user. */
const gameLinksRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/game-links', { schema: { querystring: weekQuery } }, async (request) => {
    const user = requireUser(request);
    const nfl = await getCurrentNflState(fastify.lineupCache);
    const season = Number(nfl.season);
    const week = request.query.week ?? nfl.week;

    const { data: games, error: gamesError } = await fastify.supabase
      .from('games')
      .select('id')
      .eq('season_year', season)
      .eq('week', week)
      .eq('season_type', nfl.seasonType);
    if (gamesError) throw gamesError;

    const gameIds = (games ?? []).map((game) => game.id);
    if (gameIds.length === 0) return { week, links: [] };

    const { data, error } = await fastify.supabase
      .from('user_game_links')
      .select('game_id, url, updated_at')
      .eq('user_id', user.id)
      .in('game_id', gameIds);
    if (error) throw error;

    const links = ((data ?? []) as LinkRow[])
      .map((row) => linkResponse(row))
      .sort((a, b) => a.game_id.localeCompare(b.game_id));
    return { week, links };
  });

  fastify.put(
    '/game-links/:gameId',
    { schema: { params: gameParams, body: putBody } },
    async (request) => {
      const user = requireUser(request);
      const parsed = parseGameLinkUrl(request.body.url);
      if (parsed === null) {
        throw new ApiError(400, 'game_link_invalid', 'That link is not a valid https URL.');
      }

      const { data: game, error: gameError } = await fastify.supabase
        .from('games')
        .select('id')
        .eq('id', request.params.gameId)
        .maybeSingle();
      if (gameError) throw gameError;
      if (game === null) {
        throw new ApiError(404, 'game_not_found', 'Game not found.');
      }

      const { data, error } = await fastify.supabase
        .from('user_game_links')
        .upsert(
          {
            user_id: user.id,
            game_id: game.id,
            url: parsed.url,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,game_id' },
        )
        .select('game_id, url, updated_at')
        .single();
      if (error) throw error;

      return linkResponse(data as LinkRow);
    },
  );

  fastify.delete(
    '/game-links/:gameId',
    { schema: { params: gameParams } },
    async (request, reply) => {
      const user = requireUser(request);
      const { error } = await fastify.supabase
        .from('user_game_links')
        .delete()
        .eq('user_id', user.id)
        .eq('game_id', request.params.gameId);
      if (error) throw error;
      return reply.status(204).send();
    },
  );
};

export default gameLinksRoutes;
