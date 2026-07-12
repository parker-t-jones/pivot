import type { LineupCacheProvider } from '../cache/index.js';
import { getCurrentNflState } from './nfl-state.js';
import { syncLeagueLineup, type SyncLeagueLineupDeps } from './lineup-sync.js';
import type { SupabaseServiceClient } from './supabase.js';

const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface WorkerCycleDeps {
  supabase: SupabaseServiceClient;
  lineupCache: LineupCacheProvider;
}

export interface WorkerCycleState {
  lastDailySyncAt: number | null;
}

export interface WorkerCycleResult {
  ran: boolean;
  syncedLeagueCount: number;
  failedLeagueCount: number;
  nextState: WorkerCycleState;
}

/**
 * One polling tick of the lineup sync worker (PLAN.md Section 11 Sprint 3 note; instruction
 * #9/#10 in the sprint kickoff). Sourced from Sleeper's `/v1/state/nfl` rather than Sportradar
 * game windows, since Sportradar access (Sprint 2) is deferred:
 *
 * - `season_type` `'regular'` or `'post'`: sync every tick (the caller polls every 5 minutes).
 * - `'off'` (and `'pre'`, treated the same — no games count yet): sync at most once a day.
 */
export async function runWorkerCycle(
  deps: WorkerCycleDeps,
  state: WorkerCycleState,
  now: number = Date.now(),
): Promise<WorkerCycleResult> {
  const nflState = await getCurrentNflState(deps.lineupCache);
  const isActiveSeason = nflState.seasonType === 'regular' || nflState.seasonType === 'post';
  const dueForDailySync =
    state.lastDailySyncAt === null || now - state.lastDailySyncAt >= DAILY_SYNC_INTERVAL_MS;

  if (!isActiveSeason && !dueForDailySync) {
    return { ran: false, syncedLeagueCount: 0, failedLeagueCount: 0, nextState: state };
  }

  const { data: leagues, error } = await deps.supabase
    .from('leagues')
    .select('id, user_id, platform, external_league_id, external_roster_id')
    .eq('platform', 'sleeper');
  if (error) throw error;

  const syncDeps: SyncLeagueLineupDeps = deps;
  let syncedLeagueCount = 0;
  let failedLeagueCount = 0;
  for (const league of leagues ?? []) {
    try {
      await syncLeagueLineup(syncDeps, league, nflState.week);
      syncedLeagueCount++;
    } catch (error_) {
      failedLeagueCount++;
      console.error(`Lineup sync failed for league ${league.id}:`, error_);
    }
  }

  return {
    ran: true,
    syncedLeagueCount,
    failedLeagueCount,
    nextState: { lastDailySyncAt: isActiveSeason ? state.lastDailySyncAt : now },
  };
}
