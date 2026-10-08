/**
 * Read-only diff of the slot lineup cache and the stakes lineup cache.
 *
 * Bye-week players (no regular-season game that season and week) are removed
 * from the slot cache before the diff. Does not write Redis or Postgres.
 * Refuses any non-local `SUPABASE_URL`, including with `--allow-remote`.
 *
 * Usage:
 *   pnpm compare:caches
 *   pnpm compare:caches -- --season 2026 --week 1
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../services/api/src/lib/database.types.js';
import {
  diffLineupCaches,
  formatCompareDifference,
  formatCompareSummary,
  omitByePlayers,
  assembleUserLineupCache,
} from '../services/api/src/lib/lineupCacheAssemble.js';
import {
  loadSlotCachePlayers,
  loadStakeCachePlayers,
  loadWatchedLeagues,
} from '../services/api/src/lib/lineup-sync.js';
import type { SupabaseServiceClient } from '../services/api/src/lib/supabase.js';
import { sleeperClient } from '../services/api/src/providers/sleeper-client.js';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

export function parseCompareArgs(argv: readonly string[]): {
  season: number | null;
  week: number | null;
} {
  let season: number | null = null;
  let week: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--season') {
      season = readInt(argv[i + 1], '--season');
      i += 1;
      continue;
    }
    if (arg === '--week') {
      week = readInt(argv[i + 1], '--week');
      i += 1;
      continue;
    }
    throw new RemoteSafetyError(`compare-caches: unknown argument ${String(arg)}`);
  }
  return { season, week };
}

function readInt(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new RemoteSafetyError(`compare-caches: ${flag} requires an integer`);
  }
  return Number(value);
}

async function currentNflWeek(): Promise<{ season: number; week: number }> {
  const state = await sleeperClient.getNflState();
  const season = Number(state.season);
  if (!Number.isInteger(season)) {
    throw new RemoteSafetyError(`compare-caches: Sleeper season ${state.season} is not an integer`);
  }
  return { season, week: state.week };
}

async function teamsWithRegularGame(
  supabase: SupabaseServiceClient,
  season: number,
  week: number,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('games')
    .select('home_team_id, away_team_id')
    .eq('season_year', season)
    .eq('week', week)
    .eq('season_type', 'regular');
  if (error) throw error;
  const teams = new Set<string>();
  for (const game of data ?? []) {
    teams.add(game.home_team_id);
    teams.add(game.away_team_id);
  }
  return teams;
}

async function compareUsers(
  supabase: SupabaseServiceClient,
  season: number,
  week: number,
): Promise<{ summary: string; lines: string[]; different: number }> {
  const teams = await teamsWithRegularGame(supabase, season, week);
  const { data: leagueRows, error } = await supabase.from('leagues').select('user_id');
  if (error) throw error;
  const userIds = [...new Set((leagueRows ?? []).map((row) => row.user_id))].sort();

  let identical = 0;
  let different = 0;
  let byeExcluded = 0;
  const lines: string[] = [];

  for (const userId of userIds) {
    const loaded = await loadWatchedLeagues(supabase, userId);
    const leagues = loaded.watchedLeagues.filter((league) => league.seasonYear === season);
    if (leagues.length === 0) continue;

    const slotRows = await loadSlotCachePlayers(supabase, leagues, week);
    const stakeRows = await loadStakeCachePlayers(supabase, userId, leagues, week);
    const slotCache = omitByePlayers(assembleUserLineupCache(userId, week, slotRows), teams);
    byeExcluded += slotCache.removedPlayerIds.length;
    const stakeCache = assembleUserLineupCache(userId, week, stakeRows);
    const leagueByPlayer = new Map<string, string>();
    for (const row of slotRows) leagueByPlayer.set(row.playerId, row.leagueId);
    for (const row of stakeRows) leagueByPlayer.set(row.playerId, row.leagueId);
    const differences = diffLineupCaches(slotCache.cache, stakeCache, leagueByPlayer);
    if (differences.length === 0) {
      identical += 1;
      continue;
    }
    different += 1;
    for (const difference of differences) {
      lines.push(formatCompareDifference(userId, difference));
    }
  }

  return {
    summary: formatCompareSummary({
      users: identical + different,
      identical,
      different,
      byeExcluded,
    }),
    lines,
    different,
  };
}

async function main(): Promise<void> {
  const cli = bootstrapSeedScript({
    scriptName: 'compare-caches',
    forbidRemoteAlways: true,
  });
  const args = parseCompareArgs(cli.rest);
  const current = args.season === null || args.week === null ? await currentNflWeek() : null;
  const season = args.season ?? current?.season;
  const week = args.week ?? current?.week;
  if (season === undefined || week === undefined) {
    throw new RemoteSafetyError('compare-caches: season and week are required');
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new RemoteSafetyError(
      'compare-caches: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
  }
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const result = await compareUsers(supabase, season, week);
  console.log(result.summary);
  for (const line of result.lines) console.log(line);
  if (result.different > 0) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err: unknown) => {
    if (err instanceof RemoteSafetyError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(err);
    process.exit(1);
  });
}
