import type { Position, UserLineupCache } from '@fantasy-focus/shared';
import type { LineupCacheProvider } from '../cache/index.js';
import { getFantasyProvider } from '../providers/index.js';
import { ApiError } from './errors.js';
import type { SupabaseServiceClient } from './supabase.js';

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

const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Fetches a league's lineup from its `FantasyProvider`, persists it to `lineup_slots`
 * (Section 7), and materializes the active (starter/flex) portion into `user_lineup_cache`
 * (Section 7 Redis schemas) — the Sprint 3 goal.
 *
 * Upserts on `(league_id, week, player_id)` rather than delete-and-reinsert so `is_star`
 * survives repeated syncs; players dropped from the roster since the last sync are removed.
 */
export async function syncLeagueLineup(
  deps: SyncLeagueLineupDeps,
  league: LeagueRow,
  week: number,
): Promise<{ slotCount: number }> {
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

  const normalizedSlots = await provider.fetchLineup({
    externalLeagueId: league.external_league_id,
    externalRosterId: league.external_roster_id,
    week,
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

  // Players that don't resolve to a seeded row (all IDP players, or anyone not yet seeded)
  // are silently dropped — see scripts/seed-players.ts for what's seeded.
  const rows = normalizedSlots.flatMap((slot) => {
    const player = playerBySleeperId.get(slot.externalPlayerId);
    if (!player) return [];
    return [
      {
        league_id: league.id,
        week,
        player_id: player.id,
        slot_type: slot.slotType,
        position_in_lineup: slot.positionInLineup,
      },
    ];
  });

  const { data: existingRows, error: existingError } = await deps.supabase
    .from('lineup_slots')
    .select('player_id')
    .eq('league_id', league.id)
    .eq('week', week);
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
      .eq('week', week)
      .in('player_id', droppedPlayerIds);
    if (deleteError) throw deleteError;
  }

  await deps.supabase
    .from('leagues')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', league.id);

  await refreshLineupCache(deps, league, week);

  return { slotCount: rows.length };
}

/**
 * Rebuilds `user_lineup_cache:{user_id}:{week}` (Section 7) from the *starter/flex* slots
 * currently in `lineup_slots` — bench players don't drive flags (Section 8) so they're
 * excluded. One league per user in v1 (Section 4), so this fully replaces the cache entry.
 *
 * Reads fresh from the DB (rather than reusing in-memory sync state) so it's equally usable
 * after a provider sync or after a manual lineup PUT (`routes/leagues.ts`).
 */
export async function refreshLineupCache(
  deps: SyncLeagueLineupDeps,
  league: Pick<LeagueRow, 'id' | 'user_id'>,
  week: number,
): Promise<void> {
  const { data: activeSlots, error } = await deps.supabase
    .from('lineup_slots')
    .select('player_id, is_star, players(team_id, position)')
    .eq('league_id', league.id)
    .eq('week', week)
    .in('slot_type', ['starter', 'flex']);
  if (error) throw error;

  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const starPlayerIds = new Set<string>();

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

  const cache: UserLineupCache = {
    userId: league.user_id,
    week,
    teamPositions,
    playerToTeam,
    starPlayerIds,
  };
  await deps.lineupCache.setLineupCache(league.user_id, week, cache);

  for (const teamId of teamPositions.keys()) {
    await deps.lineupCache.addUserStake(teamId, league.user_id);
  }
}
