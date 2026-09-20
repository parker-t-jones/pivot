import type { Position, UserLineupCache } from '@pivot/shared';
import { parsePreferences } from '@pivot/shared';
import type { LineupCacheProvider } from '../cache/index.js';
import { getFantasyProvider } from '../providers/index.js';
import { ApiError } from './errors.js';
import { getCurrentNflState } from './nfl-state.js';
import {
  deriveDisplayPhaseNow,
  derivePhaseOpeners,
  type NflPhase,
} from './phase-openers.js';
import type { SupabaseServiceClient } from './supabase.js';
import { resolveWatchedLeagueIds, updateWatchedLeagueIds } from './watched-leagues.js';

export type LineupSource = 'matchup' | 'roster_fallback';

export interface LeagueRow {
  id: string;
  user_id: string;
  /** `string`, not `LeaguePlatform` — see `providers/index.ts` for why. */
  platform: string;
  external_league_id: string | null;
  external_roster_id: string | null;
}

export interface SyncLeagueLineupDeps {
  supabase: SupabaseServiceClient;
  lineupCache: LineupCacheProvider;
}

export interface LineupSyncContext {
  week: number;
  displayPhase: NflPhase;
  regularSeasonStart: string | null;
  seasonType: NflPhase;
}

export interface SyncLeagueLineupResult {
  slotCount: number;
  lineupSource: LineupSource;
  week: number;
}

const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000';

/** Resolve week + schedule-derived `display_phase` for sync / worker cadence. */
export async function getLineupSyncContext(
  deps: SyncLeagueLineupDeps,
): Promise<LineupSyncContext> {
  const nflState = await getCurrentNflState(deps.lineupCache);
  const openers = await derivePhaseOpeners(deps.supabase);
  const displayPhase = deriveDisplayPhaseNow(openers, nflState.seasonType);
  return {
    week: nflState.week,
    displayPhase,
    regularSeasonStart: openers.regularSeasonStart,
    seasonType: nflState.seasonType,
  };
}

/**
 * Fetches a league's lineup from its `FantasyProvider` and persists it.
 *
 * - `display_phase` `'off'`/`'pre'`: skip matchups; store `leagues.fallback_roster` +
 *   `lineup_source = 'roster_fallback'` (no `lineup_slots` writes — not week-scoped data).
 * - `'regular'`/`'post'`: matchup-scoped slots into `lineup_slots`, `lineup_source = 'matchup'`,
 *   clear `fallback_roster`.
 *
 * Upserts on `(league_id, week, player_id)` for the matchup path so `is_star` survives syncs.
 */
export async function syncLeagueLineup(
  deps: SyncLeagueLineupDeps,
  league: LeagueRow,
  context: Pick<LineupSyncContext, 'week' | 'displayPhase'>,
): Promise<SyncLeagueLineupResult> {
  const provider = getFantasyProvider(league.platform);
  if (!provider || !provider.supportsSync()) {
    throw new ApiError(
      400,
      'sync_not_supported',
      `Leagues on platform "${league.platform}" cannot be synced from an external source.`,
    );
  }
  if (!league.external_league_id || !league.external_roster_id) {
    throw new ApiError(
      400,
      'league_not_connected',
      'League is missing external league/roster identifiers.',
    );
  }

  const useRosterFallback =
    context.displayPhase === 'off' || context.displayPhase === 'pre';

  if (useRosterFallback) {
    const externalIds = await provider.fetchRosterPlayers({
      externalLeagueId: league.external_league_id,
      externalRosterId: league.external_roster_id,
    });
    const playerIds = await resolveSleeperIdsToPlayerIds(deps.supabase, externalIds);
    assertPlayersResolved(externalIds.length, playerIds.length);

    const { error: updateError } = await deps.supabase
      .from('leagues')
      .update({
        last_synced_at: new Date().toISOString(),
        lineup_source: 'roster_fallback',
        fallback_roster: playerIds,
      })
      .eq('id', league.id);
    if (updateError) throw updateError;

    await refreshLineupCache(deps, league, context.week, {
      lineupSource: 'roster_fallback',
      fallbackPlayerIds: playerIds,
    });

    return {
      slotCount: playerIds.length,
      lineupSource: 'roster_fallback',
      week: context.week,
    };
  }

  const normalizedSlots = await provider.fetchLineup({
    externalLeagueId: league.external_league_id,
    externalRosterId: league.external_roster_id,
    week: context.week,
  });

  const sleeperIds = [...new Set(normalizedSlots.map((slot) => slot.externalPlayerId))];
  const { data: players, error: playersError } = await deps.supabase
    .from('players')
    .select('id, sleeper_id, team_id, position')
    .in('sleeper_id', sleeperIds.length > 0 ? sleeperIds : [IMPOSSIBLE_UUID]);
  if (playersError) throw playersError;

  const playerBySleeperId = new Map(
    (players ?? [])
      .filter((p): p is typeof p & { sleeper_id: string } => p.sleeper_id !== null)
      .map((p) => [p.sleeper_id, p]),
  );

  // Players that don't resolve to a seeded row (all IDP, or anyone not yet seeded) are
  // dropped — see scripts/seed-players.ts. Fail loud when *every* id drops (usually means
  // `pnpm seed:players` was never run); partial drops (e.g. IDP-only) still succeed.
  const rows = normalizedSlots.flatMap((slot) => {
    const player = playerBySleeperId.get(slot.externalPlayerId);
    if (!player) return [];
    return [
      {
        league_id: league.id,
        week: context.week,
        player_id: player.id,
        slot_type: slot.slotType,
        position_in_lineup: slot.positionInLineup,
      },
    ];
  });
  assertPlayersResolved(sleeperIds.length, rows.length);

  const { data: existingRows, error: existingError } = await deps.supabase
    .from('lineup_slots')
    .select('player_id')
    .eq('league_id', league.id)
    .eq('week', context.week);
  if (existingError) throw existingError;

  if (rows.length > 0) {
    const { error: upsertError } = await deps.supabase
      .from('lineup_slots')
      .upsert(rows, { onConflict: 'league_id,week,player_id' });
    if (upsertError) throw upsertError;
  }

  const keptPlayerIds = new Set(rows.map((row) => row.player_id));
  const droppedPlayerIds = (existingRows ?? [])
    .map((row) => row.player_id)
    .filter((playerId) => !keptPlayerIds.has(playerId));
  if (droppedPlayerIds.length > 0) {
    const { error: deleteError } = await deps.supabase
      .from('lineup_slots')
      .delete()
      .eq('league_id', league.id)
      .eq('week', context.week)
      .in('player_id', droppedPlayerIds);
    if (deleteError) throw deleteError;
  }

  const { error: updateError } = await deps.supabase
    .from('leagues')
    .update({
      last_synced_at: new Date().toISOString(),
      lineup_source: 'matchup',
      fallback_roster: null,
    })
    .eq('id', league.id);
  if (updateError) throw updateError;

  await refreshLineupCache(deps, league, context.week, { lineupSource: 'matchup' });

  return {
    slotCount: rows.length,
    lineupSource: 'matchup',
    week: context.week,
  };
}

/**
 * External roster had players but none mapped to seeded `players` rows — almost always
 * means `pnpm seed:players` hasn't been run (or the DB was reset). A silent empty success
 * is worse than a loud error for connect / `/sync`.
 */
function assertPlayersResolved(externalCount: number, resolvedCount: number): void {
  if (externalCount > 0 && resolvedCount === 0) {
    throw new ApiError(
      503,
      'players_not_seeded',
      `Sleeper returned ${externalCount} roster player(s) but none resolved to seeded players. Run \`pnpm seed:players\` (and ensure teams are seeded).`,
      { external_count: externalCount, resolved_count: 0 },
    );
  }
}

async function resolveSleeperIdsToPlayerIds(
  supabase: SupabaseServiceClient,
  sleeperIds: string[],
): Promise<string[]> {
  const unique = [...new Set(sleeperIds)];
  if (unique.length === 0) return [];

  const { data: players, error } = await supabase
    .from('players')
    .select('id, sleeper_id')
    .in('sleeper_id', unique);
  if (error) throw error;

  const idBySleeper = new Map(
    (players ?? [])
      .filter((p): p is typeof p & { sleeper_id: string } => p.sleeper_id !== null)
      .map((p) => [p.sleeper_id, p.id]),
  );

  // Preserve roster order; drop unseeded (e.g. IDP).
  return unique.flatMap((sleeperId) => {
    const id = idBySleeper.get(sleeperId);
    return id ? [id] : [];
  });
}

export interface RefreshLineupCacheOptions {
  lineupSource: LineupSource | null;
  /** Required when `lineupSource === 'roster_fallback'`. */
  fallbackPlayerIds?: string[];
}

/**
 * Rebuilds `user_lineup_cache:{user_id}:{week}` from **watched** leagues only
 * (union of starter/flex slots, or roster_fallback players).
 *
 * Replaces the old single-league overwrite so multi-league / Active Lineup works.
 */
export async function rebuildUserLineupCache(
  deps: SyncLeagueLineupDeps,
  userId: string,
  week: number,
): Promise<void> {
  const { data: userRow, error: userError } = await deps.supabase
    .from('users')
    .select('preferences, subscription_tier')
    .eq('id', userId)
    .single();
  if (userError) throw userError;

  const { data: leagues, error: leaguesError } = await deps.supabase
    .from('leagues')
    .select('id, lineup_source, fallback_roster')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (leaguesError) throw leaguesError;

  const ownedIds = (leagues ?? []).map((l) => l.id);
  const prefs = parsePreferences(userRow.preferences);
  const watchedIds = resolveWatchedLeagueIds({
    preferences: prefs,
    subscriptionTier: userRow.subscription_tier,
    ownedLeagueIds: ownedIds,
  });

  // Persist auto-filled watch list when we had to default.
  if (
    JSON.stringify(prefs.watchedLeagueIds) !== JSON.stringify(watchedIds) &&
    (watchedIds.length > 0 || prefs.watchedLeagueIds.length > 0)
  ) {
    await updateWatchedLeagueIds(deps.supabase, userId, watchedIds);
  }

  const watchedSet = new Set(watchedIds);
  const watchedLeagues = (leagues ?? []).filter((l) => watchedSet.has(l.id));

  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const starPlayerIds = new Set<string>();

  for (const league of watchedLeagues) {
    if (league.lineup_source === 'roster_fallback') {
      const playerIds = parseFallbackRoster(league.fallback_roster);
      const { data: players, error } = await deps.supabase
        .from('players')
        .select('id, team_id, position')
        .in('id', playerIds.length > 0 ? playerIds : [IMPOSSIBLE_UUID]);
      if (error) throw error;
      const byId = new Map((players ?? []).map((p) => [p.id, p]));
      for (const playerId of playerIds) {
        const player = byId.get(playerId);
        if (!player) continue;
        playerToTeam.set(playerId, player.team_id);
        const category: 'offense' | 'defense' =
          (player.position as Position) === 'DEF' ? 'defense' : 'offense';
        const categories = teamPositions.get(player.team_id) ?? new Set<'offense' | 'defense'>();
        categories.add(category);
        teamPositions.set(player.team_id, categories);
      }
      continue;
    }

    const { data: activeSlots, error } = await deps.supabase
      .from('lineup_slots')
      .select('player_id, is_star, players(team_id, position)')
      .eq('league_id', league.id)
      .eq('week', week)
      .in('slot_type', ['starter', 'flex']);
    if (error) throw error;

    for (const slot of activeSlots ?? []) {
      const player = slot.players;
      if (!player) continue;
      playerToTeam.set(slot.player_id, player.team_id);
      const category: 'offense' | 'defense' =
        (player.position as Position) === 'DEF' ? 'defense' : 'offense';
      const categories = teamPositions.get(player.team_id) ?? new Set<'offense' | 'defense'>();
      categories.add(category);
      teamPositions.set(player.team_id, categories);
      if (slot.is_star) starPlayerIds.add(slot.player_id);
    }
  }

  const previous = await deps.lineupCache.getLineupCache(userId, week);
  const nextTeamIds = new Set(teamPositions.keys());
  if (previous) {
    for (const teamId of previous.teamPositions.keys()) {
      if (!nextTeamIds.has(teamId)) {
        await deps.lineupCache.removeUserStake(teamId, userId);
      }
    }
  }

  const cache: UserLineupCache = {
    userId,
    week,
    teamPositions,
    playerToTeam,
    starPlayerIds,
  };
  await deps.lineupCache.setLineupCache(userId, week, cache);

  for (const teamId of teamPositions.keys()) {
    await deps.lineupCache.addUserStake(teamId, userId);
  }
}

/**
 * After a single-league sync/edit — rebuild the user's full watched-league cache.
 * Kept as the call-site name used throughout leagues routes.
 */
export async function refreshLineupCache(
  deps: SyncLeagueLineupDeps,
  league: Pick<LeagueRow, 'id' | 'user_id'>,
  week: number,
  _options?: RefreshLineupCacheOptions,
): Promise<void> {
  await rebuildUserLineupCache(deps, league.user_id, week);
}

function parseFallbackRoster(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface LineupResponseLeague {
  id: string;
  last_synced_at: string | null;
  lineup_source: string | null;
  fallback_roster: unknown;
}

/** Shared enrichment behind `GET` / `PUT /leagues/:id/lineup` (Section 9). */
export async function buildLineupResponse(
  supabase: SupabaseServiceClient,
  league: LineupResponseLeague,
  week: number,
  regularSeasonStart: string | null,
) {
  const lineupSource =
    league.lineup_source === 'matchup' || league.lineup_source === 'roster_fallback'
      ? league.lineup_source
      : null;

  if (lineupSource === 'roster_fallback') {
    const playerIds = parseFallbackRoster(league.fallback_roster);
    const { data: players, error } = await supabase
      .from('players')
      .select('id, first_name, last_name, position, teams(id, abbreviation, name)')
      .in('id', playerIds.length > 0 ? playerIds : [IMPOSSIBLE_UUID]);
    if (error) throw error;

    const byId = new Map((players ?? []).map((p) => [p.id, p]));
    const slots = playerIds.flatMap((playerId) => {
      const player = byId.get(playerId);
      if (!player) return [];
      return [
        {
          // No lineup_slots row — use player_id as a stable client key.
          slot_id: player.id,
          slot_type: 'starter' as const,
          position_in_lineup: player.position,
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
          is_star: false,
        },
      ];
    });

    return {
      league_id: league.id,
      week,
      last_synced_at: league.last_synced_at,
      lineup_source: lineupSource,
      regular_season_start: regularSeasonStart,
      slots,
    };
  }

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
    lineup_source: lineupSource,
    regular_season_start: regularSeasonStart,
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
