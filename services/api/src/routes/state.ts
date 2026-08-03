import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/**
 * PLAN.md Section 9 `GET /state/nfl` (Sprint 10) — current NFL calendar metadata for Home's state
 * machine (especially State 4a). League/NFL-scoped, not game-scoped — deliberately separate from
 * `GET /games?week=` / `GET /games/live` so Home can short-circuit in the offseason without a
 * games fetch. Sourced via `getCurrentNflState` (Sleeper `/v1/state/nfl`, Redis `current_nfl_state`).
 */
const stateRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/state/nfl', async (request) => {
    requireUser(request);
    const nflState = await getCurrentNflState(fastify.lineupCache);
    return {
      season: nflState.season,
      week: nflState.week,
      season_type: nflState.seasonType,
      season_start_date: nflState.seasonStartDate,
    };
  });
};

export default stateRoutes;
