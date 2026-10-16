import type { LineupResponse } from './leagues';
import type { MeResponse } from './me';
import type { ScheduleGame } from './schedule';
import type { ManualStake } from './stakes';

/**
 * Full-screen loader only before the first lineup arrives. A refocus that already
 * has a lineup keeps that screen up while the refetch runs.
 */
export function showFullLoading(hasData: boolean, loading: boolean): boolean {
  return loading && !hasData;
}

/** Matches the tab title: Watchlist when bets are on, Lineup when they are off. */
export function lineupLoadingMessage(watchlist: boolean): string {
  return watchlist ? 'Loading watchlist…' : 'Loading lineup…';
}

/**
 * Last Watchlist paint. The tab screen remounts on a Home → Watchlist switch, so
 * component state alone cannot keep the previous lineup on screen. The module
 * stays loaded, same as the watchlist filter.
 */
export interface RememberedWatchlist {
  lineup: LineupResponse;
  weekGames: ScheduleGame[] | null;
  bets: ManualStake[];
  stakesKnown: boolean;
  me: MeResponse | null;
  nflWeek: number | null;
  watchedStarterTotal: number | null;
  selectedLeagueId: string | null;
}

let remembered: RememberedWatchlist | null = null;

export function readRememberedWatchlist(): RememberedWatchlist | null {
  return remembered;
}

export function rememberWatchlist(next: RememberedWatchlist): void {
  remembered = next;
}

export function clearRememberedWatchlist(): void {
  remembered = null;
}
