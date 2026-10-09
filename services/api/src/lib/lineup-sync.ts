import { parsePreferences } from '@pivot/shared';
import type { LineupCacheProvider } from '../cache/index.js';
import type { FetchedLineup, NormalizedLineupSlot } from '../providers/fantasy-provider.js';
import { getFantasyProvider } from '../providers/index.js';
import { ApiError } from './errors.js';
import { assembleUserLineupCache, type CachePlayerRow } from './lineupCacheAssemble.js';
import { resolveOpponentStakeSlots, type OpponentStakeSlot } from './opponentStakes.js';
import { getCurrentNflState } from './nfl-state.js';
import { deriveDisplayPhaseNow, derivePhaseOpeners, type NflPhase } from './phase-openers.js';
import type { Json } from './database.types.js';
import type { SupabaseServiceClient } from './supabase.js';
import {
  formatStakesReadFailure,
  formatStakesReadGuard,
  formatStakesWriteFailure,
  stakesReadEnabled,
  stakesWriteEnabled,
  writeThroughLeagueStakes,
  writeThroughOpponentStakes,
} from './stakesWriteThrough.js';
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
export async function getLineupSyncContext(deps: SyncLeagueLineupDeps): Promise<LineupSyncContext> {
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

  const useRosterFallback = context.displayPhase === 'off' || context.displayPhase === 'pre';

  if (useRosterFallback) {
    const externalIds = await provider.fetchRosterPlayers({
      externalLeagueId: league.external_league_id,
      externalRosterId: league.external_roster_id,
    });
    const { playerIds, unresolvedIds } = await resolveSleeperIdsToPlayerIds(
      deps.supabase,
      externalIds,
    );
    logUnresolvedPlayers(league.id, context.week, unresolvedIds, playerIds.length);
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

    await writeThroughOpponentStakes(deps.supabase, league.id, context.week, []);
    await writeThroughLeagueStakes(deps.supabase, league.id, context.week);
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

  const fetched = readFetchedLineup(
    await provider.fetchLineup({
      externalLeagueId: league.external_league_id,
      externalRosterId: league.external_roster_id,
      week: context.week,
    }),
  );
  const normalizedSlots = fetched.slots;

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

  // Players that don't resolve to a seeded row are dropped. Fail loud when *every* id
  // drops (usually means `pnpm seed:players` was never run); partial drops still succeed
  // and are logged.
  const unresolvedIds = sleeperIds.filter((sleeperId) => !playerBySleeperId.has(sleeperId));
  const opponentResolved = await readOpponentForWrite(deps.supabase, league, fetched.opponentSlots);
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
  logUnresolvedPlayers(
    league.id,
    context.week,
    [...unresolvedIds, ...(opponentResolved?.unresolvedIds ?? [])],
    sleeperIds.length - unresolvedIds.length,
  );
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

  if (opponentResolved) {
    await writeThroughOpponentStakes(
      deps.supabase,
      league.id,
      context.week,
      opponentResolved.slots,
    );
  }
  await writeThroughLeagueStakes(deps.supabase, league.id, context.week);
  await refreshLineupCache(deps, league, context.week, { lineupSource: 'matchup' });

  return {
    slotCount: rows.length,
    lineupSource: 'matchup',
    week: context.week,
  };
}

function isSlotList(
  value: FetchedLineup | readonly NormalizedLineupSlot[],
): value is readonly NormalizedLineupSlot[] {
  return Array.isArray(value);
}

/**
 * Opponent ids missing from `players` join the lineup-sync unresolved log.
 * A lookup failure skips the replace so a previous opponent set is left in place.
 * `null` means the flag is off or the lookup failed.
 */
async function readOpponentForWrite(
  supabase: SupabaseServiceClient,
  league: LeagueRow,
  lineup: readonly NormalizedLineupSlot[],
): Promise<{ slots: OpponentStakeSlot[]; unresolvedIds: string[] } | null> {
  if (!stakesWriteEnabled()) return null;
  try {
    const sleeperIds = [
      ...new Set(
        lineup
          .filter((slot) => slot.slotType === 'starter' || slot.slotType === 'flex')
          .map((slot) => slot.externalPlayerId),
      ),
    ];
    if (sleeperIds.length === 0) return { slots: [], unresolvedIds: [] };
    const { data, error } = await supabase
      .from('players')
      .select('id, sleeper_id, team_id, position')
      .in('sleeper_id', sleeperIds);
    if (error) throw error;
    const playersBySleeperId = new Map(
      (data ?? [])
        .filter(
          (player): player is typeof player & { sleeper_id: string } => player.sleeper_id !== null,
        )
        .map((player) => [player.sleeper_id, player]),
    );
    return resolveOpponentStakeSlots(lineup, playersBySleeperId);
  } catch (err) {
    console.error(formatStakesWriteFailure(league.user_id, league.id, err));
    return null;
  }
}

/** Test doubles still return a slot array. The Sleeper provider returns both lists. */
function readFetchedLineup(value: FetchedLineup | readonly NormalizedLineupSlot[]): FetchedLineup {
  if (isSlotList(value)) return { slots: [...value], opponentSlots: [] };
  return value;
}

/** Some Sleeper ids missed `players`, but at least one resolved. All-miss stays a 503. */
function logUnresolvedPlayers(
  leagueId: string,
  week: number,
  unresolvedIds: readonly string[],
  resolvedCount: number,
): void {
  if (resolvedCount === 0 || unresolvedIds.length === 0) return;
  const shown = unresolvedIds.slice(0, 10).join(',');
  console.log(
    `[lineup-sync] unresolved players league=${leagueId.slice(0, 8)} week=${week} count=${unresolvedIds.length} ids=${shown}`,
  );
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
): Promise<{ playerIds: string[]; unresolvedIds: string[] }> {
  const unique = [...new Set(sleeperIds)];
  if (unique.length === 0) return { playerIds: [], unresolvedIds: [] };

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

  const unresolvedIds: string[] = [];
  // Preserve roster order; drop unseeded ids.
  const playerIds = unique.flatMap((sleeperId) => {
    const id = idBySleeper.get(sleeperId);
    if (!id) {
      unresolvedIds.push(sleeperId);
      return [];
    }
    return [id];
  });
  return { playerIds, unresolvedIds };
}

export interface RefreshLineupCacheOptions {
  lineupSource: LineupSource | null;
  /** Required when `lineupSource === 'roster_fallback'`. */
  fallbackPlayerIds?: string[];
}

interface WatchedLeague {
  id: string;
  seasonYear: number;
  lineupSource: string | null;
  fallbackRoster: unknown;
}

/**
 * Rebuilds `user_lineup_cache:{user_id}:{week}` from **watched** leagues only
 * (union of starter/flex slots, or roster_fallback players).
 *
 * `STAKES_READ=1` (with `STAKES_WRITE=1`) takes the player ids from ROSTERED stakes
 * and still joins `players` and `lineup_slots` for team, position, and stars.
 * A bye-week player has no stake, so that path omits them.
 *
 * Replaces the old single-league overwrite so multi-league / Active Lineup works.
 */
export async function rebuildUserLineupCache(
  deps: SyncLeagueLineupDeps,
  userId: string,
  week: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const loaded = await loadWatchedLeagues(deps.supabase, userId);
  if (
    JSON.stringify(loaded.prefs.watchedLeagueIds) !== JSON.stringify(loaded.watchedIds) &&
    (loaded.watchedIds.length > 0 || loaded.prefs.watchedLeagueIds.length > 0)
  ) {
    await updateWatchedLeagueIds(deps.supabase, userId, loaded.watchedIds);
  }
  const { watchedLeagues } = loaded;

  let rows: CachePlayerRow[];
  if (!stakesReadEnabled(env)) {
    rows = await loadSlotCachePlayers(deps.supabase, watchedLeagues, week);
  } else if (!stakesWriteEnabled(env)) {
    console.error(formatStakesReadGuard());
    rows = await loadSlotCachePlayers(deps.supabase, watchedLeagues, week);
  } else {
    try {
      rows = await loadStakeCachePlayers(deps.supabase, userId, watchedLeagues, week);
    } catch (err) {
      console.error(formatStakesReadFailure(userId, err));
      rows = await loadSlotCachePlayers(deps.supabase, watchedLeagues, week);
    }
  }

  const cache = assembleUserLineupCache(userId, week, rows);
  const previous = await deps.lineupCache.getLineupCache(userId, week);
  const nextTeamIds = new Set(cache.teamPositions.keys());
  if (previous) {
    for (const teamId of previous.teamPositions.keys()) {
      if (!nextTeamIds.has(teamId)) {
        await deps.lineupCache.removeUserStake(teamId, userId);
      }
    }
  }

  await deps.lineupCache.setLineupCache(userId, week, cache);

  for (const teamId of cache.teamPositions.keys()) {
    await deps.lineupCache.addUserStake(teamId, userId);
  }
}

/** Watched leagues in `created_at` order. Does not write. */
export async function loadWatchedLeagues(
  supabase: SupabaseServiceClient,
  userId: string,
): Promise<{
  watchedLeagues: WatchedLeague[];
  prefs: ReturnType<typeof parsePreferences>;
  watchedIds: string[];
}> {
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('preferences, subscription_tier')
    .eq('id', userId)
    .single();
  if (userError) throw userError;

  const { data: leagues, error: leaguesError } = await supabase
    .from('leagues')
    .select('id, lineup_source, fallback_roster, season_year')
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

  const watchedSet = new Set(watchedIds);
  const watchedLeagues = (leagues ?? []).flatMap((league) => {
    if (!watchedSet.has(league.id)) return [];
    return [
      {
        id: league.id,
        seasonYear: league.season_year,
        lineupSource: league.lineup_source,
        fallbackRoster: league.fallback_roster,
      },
    ];
  });
  return { watchedLeagues, prefs, watchedIds };
}

/** Player rows the slot path remembers. Exported for the read-only compare. */
export async function loadSlotCachePlayers(
  supabase: SupabaseServiceClient,
  watchedLeagues: readonly WatchedLeague[],
  week: number,
): Promise<CachePlayerRow[]> {
  const rows: CachePlayerRow[] = [];
  for (const league of watchedLeagues) {
    if (league.lineupSource === 'roster_fallback') {
      const playerIds = parseFallbackRoster(league.fallbackRoster);
      const { data: players, error } = await supabase
        .from('players')
        .select('id, team_id, position')
        .in('id', playerIds.length > 0 ? playerIds : [IMPOSSIBLE_UUID]);
      if (error) throw error;
      const byId = new Map((players ?? []).map((p) => [p.id, p]));
      for (const playerId of playerIds) {
        const player = byId.get(playerId);
        if (!player) continue;
        rows.push({
          playerId,
          teamId: player.team_id,
          position: player.position,
          star: false,
          leagueId: league.id,
        });
      }
      continue;
    }

    const { data: activeSlots, error } = await supabase
      .from('lineup_slots')
      .select('player_id, is_star, players(team_id, position)')
      .eq('league_id', league.id)
      .eq('week', week)
      .in('slot_type', ['starter', 'flex']);
    if (error) throw error;

    for (const slot of activeSlots ?? []) {
      const player = slot.players;
      if (!player) continue;
      rows.push({
        playerId: slot.player_id,
        teamId: player.team_id,
        position: player.position,
        star: slot.is_star,
        leagueId: league.id,
      });
    }
  }
  return rows;
}

/**
 * Player ids from ROSTERED stakes for these leagues and week.
 * Team, position, and stars come from `players` / `lineup_slots`, not the stake.
 */
export async function loadStakeCachePlayers(
  supabase: SupabaseServiceClient,
  userId: string,
  watchedLeagues: readonly WatchedLeague[],
  week: number,
): Promise<CachePlayerRow[]> {
  if (watchedLeagues.length === 0) return [];

  const leagueById = new Map(watchedLeagues.map((league) => [league.id, league]));
  const { data: stakeRows, error: stakesError } = await supabase
    .from('stakes')
    .select('source_ref, season, subject, condition')
    .eq('user_id', userId)
    .eq('week', week)
    .in(
      'source_ref',
      watchedLeagues.map((league) => league.id),
    );
  if (stakesError) throw stakesError;

  const picked: { leagueId: string; playerId: string }[] = [];
  for (const row of stakeRows ?? []) {
    if (!isRosteredCondition(row.condition) || row.source_ref === null) continue;
    const league = leagueById.get(row.source_ref);
    const playerId = readStakePlayerId(row.subject);
    if (!league || !playerId || row.season !== league.seasonYear) continue;
    picked.push({ leagueId: league.id, playerId });
  }

  const playerIds = [...new Set(picked.map((row) => row.playerId))];
  const playersById = new Map<string, { id: string; team_id: string; position: string }>();
  if (playerIds.length > 0) {
    const { data: players, error } = await supabase
      .from('players')
      .select('id, team_id, position')
      .in('id', playerIds);
    if (error) throw error;
    for (const player of players ?? []) playersById.set(player.id, player);
  }

  const matchupIds = watchedLeagues
    .filter((league) => league.lineupSource !== 'roster_fallback')
    .map((league) => league.id);
  const starred = new Set<string>();
  if (matchupIds.length > 0 && playerIds.length > 0) {
    const { data: slots, error } = await supabase
      .from('lineup_slots')
      .select('league_id, player_id, is_star')
      .in('league_id', matchupIds)
      .eq('week', week)
      .in('player_id', playerIds);
    if (error) throw error;
    for (const slot of slots ?? []) {
      if (slot.is_star) starred.add(`${slot.league_id}:${slot.player_id}`);
    }
  }

  const rows: CachePlayerRow[] = [];
  for (const league of watchedLeagues) {
    const seen = new Set<string>();
    for (const item of picked) {
      if (item.leagueId !== league.id || seen.has(item.playerId)) continue;
      seen.add(item.playerId);
      const player = playersById.get(item.playerId);
      if (!player) continue;
      rows.push({
        playerId: player.id,
        teamId: player.team_id,
        position: player.position,
        star:
          league.lineupSource === 'roster_fallback'
            ? false
            : starred.has(`${league.id}:${player.id}`),
        leagueId: league.id,
      });
    }
  }
  return rows;
}

function isRosteredCondition(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value['type'] === 'ROSTERED'
  );
}

function readStakePlayerId(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const playerId = value['playerId'];
  if (value['type'] !== 'PLAYER' || typeof playerId !== 'string' || playerId.length === 0) {
    return null;
  }
  return playerId;
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
