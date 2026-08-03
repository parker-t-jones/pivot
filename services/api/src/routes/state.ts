import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { deriveDisplayPhaseNow, derivePhaseOpeners } from '../lib/phase-openers.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/**
 * PLAN.md Section 9 `GET /state/nfl` (Sprint 10) — current NFL calendar metadata for Home's state
 * machine (especially State 4a). League/NFL-scoped, not game-scoped — deliberately separate from
 * `GET /games?week=` / `GET /games/live` so Home can short-circuit in the offseason without a
 * games fetch. Sourced via `getCurrentNflState` (Sleeper `/v1/state/nfl`, Redis `current_nfl_state`)
 * plus schedule-derived phase openers / display_phase from `games` (Sprint 10 Phase 2.5).
 */
const stateRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/state/nfl', async (request) => {
    requireUser(request);
    const nflState = await getCurrentNflState(fastify.lineupCache);
    const openers = await derivePhaseOpeners(fastify.supabase);
    const displayPhase = deriveDisplayPhaseNow(openers, nflState.seasonType);
    return {
      season: nflState.season,
      week: nflState.week,
      // NOT FOR HOME DISPLAY PHASE — Sleeper's season_type runs ahead of actual games (e.g. reports
      // 'pre' before the first preseason kickoff). Engine/ingestion may still use it. Home must key
      // off `display_phase` (schedule-derived) instead. Same class of unreliability as
      // `season_start_date` below.
      season_type: nflState.seasonType,
      // UNTRUSTWORTHY FOR DISPLAY — Sleeper's season_start_date is phase-relative (preseason opener
      // during 'pre', often null during 'off'), not the regular-season start. It caused two false
      // State 4a copy bugs. Keep as passthrough metadata only; never render it in UI copy. Prefer
      // preseason_start / regular_season_start (derived from games in America/New_York).
      season_start_date: nflState.seasonStartDate,
      preseason_start: openers.preseasonStart,
      regular_season_start: openers.regularSeasonStart,
      display_phase: displayPhase,
    };
  });
};

export default stateRoutes;
