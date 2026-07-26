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
      let leagues = await sleeperClient.getUserLeagues(user.user_id, nflState.season);

      // Offseason fallback: before leagues are renewed for the upcoming season, Sleeper returns
      // an empty list for the current season even though the user's leagues exist. Fall back to
      // the previous season's leagues so the picker isn't empty. A non-empty current-season
      // result always wins; each league carries its own `season` string, so the shape is unchanged.
      if (
        leagues.length === 0 &&
        (nflState.season_type === 'off' || nflState.season_type === 'pre')
      ) {
        leagues = await sleeperClient.getUserLeagues(user.user_id, nflState.previous_season);
      }

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
