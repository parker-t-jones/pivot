import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sleeperClient } from '../providers/sleeper-client.js';
import { ApiError } from '../lib/errors.js';

/** `GET /sleeper/leagues?username={u}` — fetch a Sleeper user's leagues, no persist (Section 9). */
const sleeperRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/sleeper/leagues',
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: z.object({ username: z.string().min(1) }),
      },
    },
    async (request) => {
      const { username } = request.query;

      const user = await sleeperClient.getUserByUsername(username);
      if (!user) {
        throw new ApiError(
          404,
          'sleeper_user_not_found',
          `No Sleeper user found for username "${username}".`,
        );
      }

      const nflState = await sleeperClient.getNflState();
      const leagues = await sleeperClient.getUserLeagues(user.user_id, nflState.season);

      return {
        leagues: leagues.map((league) => ({
          league_id: league.league_id,
          name: league.name,
          season: league.season,
        })),
      };
    },
  );
};

export default sleeperRoutes;
