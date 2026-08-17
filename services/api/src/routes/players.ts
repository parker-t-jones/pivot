import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import '../plugins/services.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** `GET /players/search?q={q}&position={p}` — player autocomplete (Section 9). */
const playersRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/players/search',
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: z.object({
          q: z.string().min(1),
          position: z.enum(POSITIONS).optional(),
        }),
      },
    },
    async (request) => {
      const { q, position } = request.query;

      const { data, error } = await fastify.supabase.rpc('search_players', {
        q,
        filter_position: position ?? null,
      });
      if (error) throw error;

      return {
        players: (data ?? []).map((player) => ({
          player_id: player.id,
          first_name: player.first_name,
          last_name: player.last_name,
          position: player.position,
          team: {
            team_id: player.team_id,
            abbreviation: player.team_abbreviation,
            name: player.team_name,
          },
        })),
      };
    },
  );
};

export default playersRoutes;
