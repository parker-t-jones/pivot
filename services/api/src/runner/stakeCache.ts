import type { LineupCacheProvider } from '../cache/index.js';
import { getCurrentNflState } from '../lib/nfl-state.js';
import { rebuildUserLineupCache } from '../lib/lineup-sync.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';

export const NO_STAKE_WARNING = '[runner] warning: no stake users for any live game';

interface LiveTeams {
  homeTeamId: string;
  awayTeamId: string;
}

/**
 * Rebuilds `user_lineup_cache` and `users_with_stake` for the current NFL week
 * from watched lineups in Postgres. Same write path as the worker
 * (`rebuildUserLineupCache`). One failed user is logged and skipped so discovery
 * still starts.
 */
export async function rebuildStakeCache(deps: {
  supabase: SupabaseServiceClient;
  lineupCache: LineupCacheProvider;
  log?: (line: string) => void;
}): Promise<{ users: number; teams: number }> {
  const state = await getCurrentNflState(deps.lineupCache);
  const { data, error } = await deps.supabase.from('users').select('id');
  if (error) throw new Error(error.message);

  const teams = new Set<string>();
  let users = 0;
  for (const row of data ?? []) {
    try {
      await rebuildUserLineupCache(
        { supabase: deps.supabase, lineupCache: deps.lineupCache },
        row.id,
        state.week,
      );
    } catch (failure) {
      console.error(
        `[runner] stake cache rebuild failed for ${row.id}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      continue;
    }
    users += 1;
    const cache = await deps.lineupCache.getLineupCache(row.id, state.week);
    if (cache === null) continue;
    for (const teamId of cache.teamPositions.keys()) teams.add(teamId);
  }

  const line = `[runner] stake cache: ${users} users, ${teams.size} teams`;
  (deps.log ?? console.log)(line);
  return { users, teams: teams.size };
}

/** Null when there are no live games, or any live game has a stake user on either team. */
export async function noStakeUsersWarning(
  games: readonly LiveTeams[],
  usersWithStake: (teamId: string) => Promise<readonly string[]>,
): Promise<string | null> {
  if (games.length === 0) return null;
  for (const game of games) {
    const home = await usersWithStake(game.homeTeamId);
    const away = await usersWithStake(game.awayTeamId);
    if (home.length > 0 || away.length > 0) return null;
  }
  return NO_STAKE_WARNING;
}

/** Logs the no-stake warning at most once for this leader tenure. */
export function createNoStakeWarner(
  log: (line: string) => void,
): (
  games: readonly LiveTeams[],
  usersWithStake: (teamId: string) => Promise<readonly string[]>,
) => Promise<void> {
  let warned = false;
  return async (games, usersWithStake) => {
    if (warned) return;
    const line = await noStakeUsersWarning(games, usersWithStake);
    if (line === null) return;
    warned = true;
    log(line);
  };
}
