import type { LineupCacheProvider, NflState } from '../cache/index.js';
import { sleeperClient } from '../providers/sleeper-client.js';

const NFL_STATE_CACHE_TTL_SEC = 5 * 60;

/**
 * Current NFL week/season, sourced from Sleeper's `/v1/state/nfl` (Sprint 3 substitute for
 * Sportradar — see PLAN.md Section 11 Sprint 3 note). Cached for 5 minutes so callers don't
 * hit Sleeper on every request (Section 7 `current_nfl_state`).
 */
export async function getCurrentNflState(lineupCache: LineupCacheProvider): Promise<NflState> {
  const cached = await lineupCache.getNflState();
  if (cached) {
    // Older cache entries (pre–Sprint 10) may omit `seasonStartDate` — normalize to null.
    return { ...cached, seasonStartDate: cached.seasonStartDate ?? null };
  }

  const raw = await sleeperClient.getNflState();
  // Pass through whatever Sleeper gives: empty/missing `season_start_date` → null. Do not invent a
  // date. Field is phase-relative (see PLAN Known Issues) — clients must not treat it as the
  // regular-season opener.
  const seasonStartDate =
    typeof raw.season_start_date === 'string' && raw.season_start_date.length > 0
      ? raw.season_start_date
      : null;
  const state: NflState = {
    season: raw.season,
    week: raw.week,
    seasonType: raw.season_type,
    seasonStartDate,
  };
  await lineupCache.setNflState(state, NFL_STATE_CACHE_TTL_SEC);
  return state;
}
