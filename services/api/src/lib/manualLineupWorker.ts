import { refreshLineupCache, type SyncLeagueLineupDeps } from './lineup-sync.js';
import { carryManualLineupForward } from './manualLineupCarry.js';
import { writeThroughLeagueStakes } from './stakesWriteThrough.js';

export interface ManualCarryResult {
  carriedLeagueCount: number;
  failedLeagueCount: number;
}

/**
 * Lineup worker step: carry every manual lineup into the current week, then write its ROSTERED
 * stakes and rebuild the owner's lineup cache, so alerts follow a manual lineup into the new week
 * even before the user opens the app. Demo accounts are skipped: their lineup is a fixture.
 */
export async function carryManualLineups(
  deps: SyncLeagueLineupDeps,
  week: number,
): Promise<ManualCarryResult> {
  const { data: leagues, error } = await deps.supabase
    .from('leagues')
    .select('id, user_id, platform, manual_lineup_week')
    .eq('platform', 'manual');
  if (error) throw error;

  const due = (leagues ?? []).filter(
    (league) => league.manual_lineup_week !== null && league.manual_lineup_week < week,
  );
  if (due.length === 0) return { carriedLeagueCount: 0, failedLeagueCount: 0 };

  const { data: demoUsers, error: demoError } = await deps.supabase
    .from('users')
    .select('id')
    .eq('is_demo', true);
  if (demoError) throw demoError;
  const demoIds = new Set((demoUsers ?? []).map((user) => user.id));

  let carriedLeagueCount = 0;
  let failedLeagueCount = 0;
  for (const league of due) {
    if (demoIds.has(league.user_id)) continue;
    try {
      if (await carryManualLineupForward(deps.supabase, league, week)) {
        await writeThroughLeagueStakes(deps.supabase, league.id, week);
        await refreshLineupCache(deps, league, week);
      }
      carriedLeagueCount++;
    } catch (error_) {
      failedLeagueCount++;
      console.error(`Manual lineup carry failed for league ${league.id}:`, error_);
    }
  }
  return { carriedLeagueCount, failedLeagueCount };
}
