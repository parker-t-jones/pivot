import { computeFlagState } from '@fantasy-focus/engine';
import {
  buildGameSummary,
  decideAction,
  type Action,
  type ViewingSessionSnapshot,
} from '@fantasy-focus/dispatcher';
import { parsePreferences, type FlagEvent, type FlagState } from '@fantasy-focus/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/**
 * Section 9's `/flags/current` response only allows three values, unlike `decideAction`'s five-way
 * `Action.type` (the WebSocket `flag_event` payload's richer shape). The natural, exhaustive mapping
 * is CTA-driven: an actionable CTA (`switch_primary`/`add_to_split`) maps straight across; everything
 * else — `cta: 'dismiss'` (a stale/removed flag) or `cta: null` (`auto_switch`, already-primary
 * `in_app_indicator`) — collapses to `notify_only`, since none of those leave the user with a button
 * to tap on a cold-start snapshot.
 */
export function toRecommendedAction(
  action: Action,
): 'switch_primary' | 'add_to_split' | 'notify_only' {
  if (action.cta === 'switch_primary') return 'switch_primary';
  if (action.cta === 'add_to_split') return 'add_to_split';
  return 'notify_only';
}

/** Wraps a freshly computed `FlagState` in the minimal `FlagEvent` shell `decideAction` requires.
 *  There's no real "event" here (no transition, no dispatcher queue) — `/flags/current` is a snapshot,
 *  not a delta — so `type`/`oldState`/`scheduledFireAt` are unused filler; `decideAction` only reads
 *  `gameId` and `newState` off of a non-`flag_removed` event, and every entry here is `flagged: true`
 *  by construction (never `flag_removed`). */
function toSyntheticFlagEvent(userId: string, gameId: string, newState: FlagState): FlagEvent {
  return {
    id: '',
    userId,
    gameId,
    type: 'flag_added',
    oldState: null,
    newState,
    scheduledFireAt: 0,
  };
}

const flagsRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * PLAN.md Section 9 / Sprint 4 closeout #2: recomputes `computeFlagState` fresh from
   * `(lineup, gameState)` for every game the user has a stake in this week. Never reads the stored
   * `user_flag_state:{user_id}:{game_id}` hash — that's a change log for diffing (the WebSocket delta
   * stream's job), not authoritative state for a cold-start snapshot.
   */
  fastify.get('/flags/current', async (request) => {
    const user = requireUser(request);
    const generatedAt = new Date().toISOString();

    const nflState = await getCurrentNflState(fastify.lineupCache);
    const lineup = await fastify.lineupCache.getLineupCache(user.id, nflState.week);
    if (!lineup || lineup.teamPositions.size === 0) {
      return { flags: [], generated_at: generatedAt };
    }

    const teamIds = [...lineup.teamPositions.keys()];
    const { data: gameRows, error: gamesError } = await fastify.supabase
      .from('games')
      .select('id, home_team_id, away_team_id')
      .eq('week', nflState.week)
      .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`);
    if (gamesError) throw gamesError;

    // A user can have stake-teams that face each other this week — dedupe to one lookup per game.
    const games = [...new Map((gameRows ?? []).map((game) => [game.id, game])).values()];
    if (games.length === 0) {
      return { flags: [], generated_at: generatedAt };
    }

    const relevantTeamIds = [
      ...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id])),
    ];
    const { data: teamRows, error: teamsError } = await fastify.supabase
      .from('teams')
      .select('id, abbreviation')
      .in('id', relevantTeamIds);
    if (teamsError) throw teamsError;
    const abbreviationByTeamId = new Map((teamRows ?? []).map((team) => [team.id, team.abbreviation]));

    const { data: userRow, error: userError } = await fastify.supabase
      .from('users')
      .select('subscription_tier, preferences')
      .eq('id', user.id)
      .single();
    if (userError) throw userError;
    const preferences = parsePreferences(userRow.preferences);
    const decideActionUser = {
      subscriptionTier: userRow.subscription_tier === 'pro' ? ('pro' as const) : ('free' as const),
      autoSwitch: preferences.autoSwitch,
    };
    // Phase 6 (`viewing_sessions`) hasn't landed yet — no real session source to read `primaryGameId`/
    // `primaryPriorityScore` from. `catalogs.ts`'s `UserDirectory.getViewingSession` docstring already
    // flags this dependency as Phase 6 work; until then, "no known primary game" is the honest default,
    // which resolves to `switch_primary`/`auto_switch` for any currently-flagged game (see
    // `decideAction`) — a reasonable cold-start recommendation when nothing is playing yet.
    const session: ViewingSessionSnapshot = { primaryGameId: null, primaryPriorityScore: null };

    const flags: {
      game_id: string;
      priority_score: number;
      reasons: string[];
      flagged_player_ids: string[];
      game: ReturnType<typeof buildGameSummary>;
      recommended_action: 'switch_primary' | 'add_to_split' | 'notify_only';
    }[] = [];

    for (const game of games) {
      const gameState = await fastify.gameStateStore.getGameState(game.id);
      if (!gameState) continue;

      const flagState = computeFlagState(lineup, gameState);
      if (!flagState.flagged) continue;

      const action = decideAction(
        decideActionUser,
        session,
        toSyntheticFlagEvent(user.id, game.id, flagState),
      );

      flags.push({
        game_id: flagState.gameId,
        priority_score: flagState.priorityScore,
        reasons: flagState.reasons.map((reason) => reason.type),
        flagged_player_ids: [
          ...new Set(flagState.reasons.flatMap((reason) => reason.triggeringPlayerIds)),
        ],
        game: buildGameSummary(gameState, {
          homeTeamAbbreviation: abbreviationByTeamId.get(game.home_team_id) ?? '',
          awayTeamAbbreviation: abbreviationByTeamId.get(game.away_team_id) ?? '',
        }),
        recommended_action: toRecommendedAction(action),
      });
    }

    // Deterministic order (sprint instruction): priority descending, game_id ascending on ties.
    flags.sort((a, b) => b.priority_score - a.priority_score || a.game_id.localeCompare(b.game_id));

    return { flags, generated_at: generatedAt };
  });
};

export default flagsRoutes;
