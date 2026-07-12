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

      let query = fastify.supabase
        .from('players')
        .select('id, first_name, last_name, position, team_id, teams(id, abbreviation, name)')
        .eq('active', true)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .order('last_name', { ascending: true })
        .limit(20);

      if (position) {
        query = query.eq('position', position);
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        players: (data ?? []).map((player) => ({
          player_id: player.id,
          first_name: player.first_name,
          last_name: player.last_name,
          position: player.position,
          team: player.teams
            ? {
                team_id: player.teams.id,
                abbreviation: player.teams.abbreviation,
                name: player.teams.name,
              }
            : null,
        })),
      };
    },
  );
};

export default playersRoutes;
