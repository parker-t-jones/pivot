import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import '../plugins/services.js';
import { requireUser } from '../plugins/auth.js';
import { ApiError } from '../lib/errors.js';
import { getOwnedLeagueOrThrow } from '../lib/get-owned-league.js';
import { refreshLineupCache, syncLeagueLineup } from '../lib/lineup-sync.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { sleeperProvider } from '../providers/index.js';

const SLOT_TYPES = ['starter', 'bench', 'flex', 'idp'] as const;

function leagueSummary(league: {
  id: string;
  platform: string;
  name: string;
  sport: string;
  season_year: number;
  last_synced_at: string | null;
}) {
  return {
    league_id: league.id,
    platform: league.platform,
    name: league.name,
    sport: league.sport,
    season_year: league.season_year,
    last_synced_at: league.last_synced_at,
  };
}

/** Shared enrichment query behind both `GET` and `PUT /leagues/:id/lineup` (Section 9). */
async function getLineupResponse(
  supabase: SupabaseServiceClient,
  league: { id: string; last_synced_at: string | null },
  week: number,
) {
  const { data, error } = await supabase
    .from('lineup_slots')
    .select(
      'id, slot_type, position_in_lineup, is_star, players(id, first_name, last_name, position, teams(id, abbreviation, name))',
    )
    .eq('league_id', league.id)
    .eq('week', week)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return {
    league_id: league.id,
    week,
    last_synced_at: league.last_synced_at,
    slots: (data ?? []).flatMap((slot) => {
      const player = slot.players;
      if (!player) return [];
      return [
        {
          slot_id: slot.id,
          slot_type: slot.slot_type,
          position_in_lineup: slot.position_in_lineup,
          player: {
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
          },
          is_star: slot.is_star,
        },
      ];
    }),
  };
}

const leaguesRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/leagues', async (request) => {
    const { data, error } = await fastify.supabase
      .from('leagues')
      .select('*')
      .eq('user_id', requireUser(request).id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return { leagues: (data ?? []).map(leagueSummary) };
  });

  fastify.post(
    '/leagues/sleeper',
    {
      schema: {
        body: z.object({
          sleeper_username: z.string().min(1),
          league_id: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const { sleeper_username, league_id } = request.body;
      const connection = await sleeperProvider.resolveLeagueConnection(sleeper_username, league_id);
      const userId = requireUser(request).id;

      // Select-then-update/insert — not upsert/onConflict. The uniqueness backstop is a
      // *partial* unique index (WHERE external_league_id IS NOT NULL), which Postgres cannot
      // match via supabase-js's column-only onConflict string (42P10).
      const { data: existing, error: existingError } = await fastify.supabase
        .from('leagues')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'sleeper')
        .eq('external_league_id', connection.externalLeagueId)
        .maybeSingle();
      if (existingError) throw existingError;

      let league = existing;
      if (league) {
        const { data: updated, error: updateError } = await fastify.supabase
          .from('leagues')
          .update({
            name: connection.name,
            season_year: connection.seasonYear,
            external_owner_id: connection.externalOwnerId,
            external_roster_id: connection.externalRosterId,
          })
          .eq('id', league.id)
          .select('*')
          .single();
        if (updateError) throw updateError;
        league = updated;
      } else {
        const { data: inserted, error: insertError } = await fastify.supabase
          .from('leagues')
          .insert({
            user_id: userId,
            platform: 'sleeper',
            external_league_id: connection.externalLeagueId,
            external_owner_id: connection.externalOwnerId,
            external_roster_id: connection.externalRosterId,
            name: connection.name,
            sport: 'nfl',
            season_year: connection.seasonYear,
          })
          .select('*')
          .single();

        if (insertError) {
          // Race: concurrent connect slipped past the SELECT and hit the partial unique index.
          if (insertError.code === '23505') {
            const { data: raced, error: racedError } = await fastify.supabase
              .from('leagues')
              .select('*')
              .eq('user_id', userId)
              .eq('platform', 'sleeper')
              .eq('external_league_id', connection.externalLeagueId)
              .single();
            if (racedError) throw racedError;
            league = raced;
          } else {
            throw insertError;
          }
        } else {
          league = inserted;
        }
      }

      // Best-effort initial sync — connect should succeed even if the current week has no
      // matchup data yet (e.g. before the season starts). The worker/`/sync` retry later.
      try {
        const nflState = await getCurrentNflState(fastify.lineupCache);
        await syncLeagueLineup(
          { supabase: fastify.supabase, lineupCache: fastify.lineupCache },
          league,
          nflState.week,
        );
      } catch (syncError) {
        fastify.log.warn({ err: syncError, leagueId: league.id }, 'Initial Sleeper sync failed');
      }

      return reply.status(201).send(leagueSummary(league));
    },
  );

  fastify.post(
    '/leagues/manual',
    {
      schema: {
        body: z.object({
          name: z.string().min(1),
          season_year: z.coerce.number().int(),
        }),
      },
    },
    async (request, reply) => {
      const { name, season_year } = request.body;
      const { data: league, error } = await fastify.supabase
        .from('leagues')
        .insert({
          user_id: requireUser(request).id,
          platform: 'manual',
          name,
          sport: 'nfl',
          season_year,
        })
        .select('*')
        .single();
      if (error) throw error;

      return reply.status(201).send(leagueSummary(league));
    },
  );

  fastify.delete(
    '/leagues/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      const league = await getOwnedLeagueOrThrow(
        fastify.supabase,
        requireUser(request).id,
        request.params.id,
      );
      const { error } = await fastify.supabase.from('leagues').delete().eq('id', league.id);
      if (error) throw error;
      return reply.status(204).send();
    },
  );

  fastify.post(
    '/leagues/:id/sync',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const league = await getOwnedLeagueOrThrow(
        fastify.supabase,
        requireUser(request).id,
        request.params.id,
      );
      const nflState = await getCurrentNflState(fastify.lineupCache);
      const { slotCount } = await syncLeagueLineup(
        { supabase: fastify.supabase, lineupCache: fastify.lineupCache },
        league,
        nflState.week,
      );
      return { league_id: league.id, week: nflState.week, slot_count: slotCount };
    },
  );

  fastify.get(
    '/leagues/:id/lineup',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ week: z.coerce.number().int().positive().optional() }),
      },
    },
    async (request) => {
      const league = await getOwnedLeagueOrThrow(
        fastify.supabase,
        requireUser(request).id,
        request.params.id,
      );
      const week = request.query.week ?? (await getCurrentNflState(fastify.lineupCache)).week;
      return await getLineupResponse(fastify.supabase, league, week);
    },
  );

  fastify.put(
    '/leagues/:id/lineup',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          week: z.coerce.number().int().positive(),
          slots: z.array(
            z.object({
              player_id: z.string().uuid(),
              slot_type: z.enum(SLOT_TYPES),
              position_in_lineup: z.string().min(1),
              is_star: z.boolean().optional().default(false),
            }),
          ),
        }),
      },
    },
    async (request) => {
      const league = await getOwnedLeagueOrThrow(
        fastify.supabase,
        requireUser(request).id,
        request.params.id,
      );
      if (league.platform !== 'manual') {
        throw new ApiError(
          400,
          'manual_lineup_only',
          'Only manual leagues accept a direct lineup PUT — Sleeper leagues sync from Sleeper.',
        );
      }

      const { week, slots } = request.body;

      const playerIds = slots.map((slot) => slot.player_id);
      const duplicatePlayerIds = playerIds.filter((id, index) => playerIds.indexOf(id) !== index);
      if (duplicatePlayerIds.length > 0) {
        throw new ApiError(
          400,
          'duplicate_player_in_lineup',
          'A player can only occupy one lineup slot.',
          {
            player_ids: [...new Set(duplicatePlayerIds)],
          },
        );
      }

      if (playerIds.length > 0) {
        const { data: knownPlayers, error: knownPlayersError } = await fastify.supabase
          .from('players')
          .select('id')
          .in('id', playerIds);
        if (knownPlayersError) throw knownPlayersError;

        const knownPlayerIds = new Set((knownPlayers ?? []).map((p) => p.id));
        const unknownPlayerIds = playerIds.filter((id) => !knownPlayerIds.has(id));
        if (unknownPlayerIds.length > 0) {
          throw new ApiError(400, 'unknown_player_id', 'One or more players do not exist.', {
            player_ids: unknownPlayerIds,
          });
        }
      }

      const { error: deleteError } = await fastify.supabase
        .from('lineup_slots')
        .delete()
        .eq('league_id', league.id)
        .eq('week', week);
      if (deleteError) throw deleteError;

      if (slots.length > 0) {
        const { error: insertError } = await fastify.supabase.from('lineup_slots').insert(
          slots.map((slot) => ({
            league_id: league.id,
            week,
            player_id: slot.player_id,
            slot_type: slot.slot_type,
            position_in_lineup: slot.position_in_lineup,
            is_star: slot.is_star,
          })),
        );
        if (insertError) throw insertError;
      }

      await refreshLineupCache(
        { supabase: fastify.supabase, lineupCache: fastify.lineupCache },
        league,
        week,
      );

      return await getLineupResponse(fastify.supabase, league, week);
    },
  );

  fastify.post(
    '/leagues/:id/stars',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          week: z.coerce.number().int().positive(),
          player_id: z.string().uuid(),
          is_star: z.boolean(),
        }),
      },
    },
    async (request) => {
      const league = await getOwnedLeagueOrThrow(
        fastify.supabase,
        requireUser(request).id,
        request.params.id,
      );
      const { week, player_id, is_star } = request.body;

      const { data, error } = await fastify.supabase
        .from('lineup_slots')
        .update({ is_star })
        .eq('league_id', league.id)
        .eq('week', week)
        .eq('player_id', player_id)
        .select('id')
        .single();
      if (error || !data) {
        throw new ApiError(
          404,
          'lineup_slot_not_found',
          'No lineup slot found for that player/week.',
        );
      }

      await refreshLineupCache(
        { supabase: fastify.supabase, lineupCache: fastify.lineupCache },
        league,
        week,
      );

      return { week, player_id, is_star };
    },
  );
};

export default leaguesRoutes;
