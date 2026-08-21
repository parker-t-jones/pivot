import { computeFlagState } from '@roster-remote/engine';
import {
  buildGameSummary,
  decideAction,
  type Action,
  type ViewingSessionSnapshot,
} from '@roster-remote/dispatcher';
import {
  parsePreferences,
  type FlagEvent,
  type FlagState,
  type GameState,
} from '@roster-remote/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { requireUser } from '../plugins/auth.js';
import '../plugins/services.js';

/** Section 7 `flag_events.user_action` / Section 9 `POST /flags/:event_id/action` body — kept as its
 *  own constant (rather than inlining the array in the zod call) so the accepted values are visible
 *  in one place and can't silently drift from `is_valid_flag_user_action` (the DB check constraint,
 *  `supabase/migrations/20260712160000_flag_events.sql`). */
const FLAG_USER_ACTIONS = ['switched', 'added_to_split', 'dismissed', 'ignored'] as const;

const flagActionBody = z.object({
  action: z.enum(FLAG_USER_ACTIONS),
});

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
      .select('id, abbreviation, name, primary_color, secondary_color')
      .in('id', relevantTeamIds);
    if (teamsError) throw teamsError;
    const abbreviationByTeamId = new Map(
      (teamRows ?? []).map((team) => [team.id, team.abbreviation]),
    );
    // Sprint 6 Phase 3 addition — team nicknames for the same `game_summary` builder (`buildGameSummary`)
    // this route already shares with the WebSocket `flag_event` payload, batched from the same query.
    const nameByTeamId = new Map((teamRows ?? []).map((team) => [team.id, team.name]));
    // Sprint 9 Phase 1 addition — team colors for the same `buildGameSummary` builder, batched from
    // the same query as the abbreviation/name maps above.
    const primaryColorByTeamId = new Map(
      (teamRows ?? []).map((team) => [team.id, team.primary_color]),
    );
    const secondaryColorByTeamId = new Map(
      (teamRows ?? []).map((team) => [team.id, team.secondary_color]),
    );

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

    // First pass: compute the flagged games' state/action, but defer resolving player names until
    // after this loop so every flag's player ids can be looked up in a single batched query (same
    // batching approach already used for `games`/`teams` above) rather than one `players` round trip
    // per flagged game.
    const flaggedGames: {
      gameRow: (typeof games)[number];
      gameState: GameState;
      flagState: FlagState;
      recommendedAction: 'switch_primary' | 'add_to_split' | 'notify_only';
      flaggedPlayerIds: string[];
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

      flaggedGames.push({
        gameRow: game,
        gameState,
        flagState,
        recommendedAction: toRecommendedAction(action),
        flaggedPlayerIds: [
          ...new Set(flagState.reasons.flatMap((reason) => reason.triggeringPlayerIds)),
        ],
      });
    }

    const allFlaggedPlayerIds = [
      ...new Set(flaggedGames.flatMap((entry) => entry.flaggedPlayerIds)),
    ];
    const playersById = new Map<
      string,
      { id: string; first_name: string; last_name: string; position: string }
    >();
    if (allFlaggedPlayerIds.length > 0) {
      const { data: playerRows, error: playersError } = await fastify.supabase
        .from('players')
        .select('id, first_name, last_name, position')
        .in('id', allFlaggedPlayerIds);
      if (playersError) throw playersError;
      for (const player of playerRows ?? []) {
        playersById.set(player.id, player);
      }
    }

    const flags = flaggedGames.map((entry) => ({
      game_id: entry.flagState.gameId,
      priority_score: entry.flagState.priorityScore,
      reasons: entry.flagState.reasons.map((reason) => reason.type),
      // Section 9 shape (Sprint 9 Phase 1): same `{ player_id, first_name, last_name, position }`
      // shape as the WebSocket `flag_event` payload's `flagged_players`, so the client renders the
      // same object from either channel. `flatMap` silently drops any id that has no matching row
      // (shouldn't happen — every triggering id comes from this user's own lineup cache — but a
      // dangling id is not a reason to 500 a cold-start response).
      flagged_players: entry.flaggedPlayerIds.flatMap((playerId) => {
        const player = playersById.get(playerId);
        return player
          ? [
              {
                player_id: player.id,
                first_name: player.first_name,
                last_name: player.last_name,
                position: player.position,
              },
            ]
          : [];
      }),
      game: buildGameSummary(entry.gameState, {
        homeTeamAbbreviation: abbreviationByTeamId.get(entry.gameRow.home_team_id) ?? '',
        awayTeamAbbreviation: abbreviationByTeamId.get(entry.gameRow.away_team_id) ?? '',
        homeTeamName: nameByTeamId.get(entry.gameRow.home_team_id) ?? '',
        awayTeamName: nameByTeamId.get(entry.gameRow.away_team_id) ?? '',
        homeTeamPrimaryColor: primaryColorByTeamId.get(entry.gameRow.home_team_id) ?? '',
        homeTeamSecondaryColor: secondaryColorByTeamId.get(entry.gameRow.home_team_id) ?? '',
        awayTeamPrimaryColor: primaryColorByTeamId.get(entry.gameRow.away_team_id) ?? '',
        awayTeamSecondaryColor: secondaryColorByTeamId.get(entry.gameRow.away_team_id) ?? '',
      }),
      recommended_action: entry.recommendedAction,
    }));

    // Deterministic order (sprint instruction): priority descending, game_id ascending on ties.
    flags.sort((a, b) => b.priority_score - a.priority_score || a.game_id.localeCompare(b.game_id));

    return { flags, generated_at: generatedAt };
  });

  /**
   * PLAN.md Section 9 `POST /flags/:event_id/action` — records the user's response to a delivered
   * notification (Sprint 6 Phase 6's banner buttons / auto-dismiss, or Phase 7's background
   * notification-response handler) onto the `flag_events` row it's about. Skipped in Sprint 5, built
   * here per the Sprint 6 kickoff decision.
   *
   * RLS note: `flag_events` (Sprint 5 migration) only has a SELECT policy for `authenticated` —
   * writes go through `fastify.supabase` (service role, bypasses RLS) same as every other route in
   * this file and `me.ts`, with ownership enforced explicitly via the `user_id` filter below rather
   * than a new UPDATE policy/migration. Chosen over adding an RLS policy because it's the pattern
   * already established everywhere else in this codebase (`me.ts`'s push-token update,
   * `get-owned-league.ts`'s ownership check) — a client never talks to Supabase directly for this
   * table, so an UPDATE policy would only ever be exercised by this one code path anyway.
   */
  fastify.post(
    '/flags/:event_id/action',
    { schema: { params: z.object({ event_id: z.string().uuid() }), body: flagActionBody } },
    async (request) => {
      const user = requireUser(request);
      const { event_id } = request.params;
      const { action } = request.body;

      // Single round trip: the `user_id` filter IS the ownership check (service role bypasses RLS,
      // so nothing enforces it otherwise) — a row that exists but belongs to someone else fails this
      // filter exactly like a row that doesn't exist at all, so the 404 below can't be used to probe
      // for other users' event ids.
      const { data, error } = await fastify.supabase
        .from('flag_events')
        .update({ user_action: action })
        .eq('id', event_id)
        .eq('user_id', user.id)
        .select('id, user_action')
        .single();

      if (error || !data) {
        throw new ApiError(404, 'flag_event_not_found', `No flag event found with id "${event_id}".`);
      }

      return { event_id: data.id, user_action: data.user_action };
    },
  );
};

export default flagsRoutes;
