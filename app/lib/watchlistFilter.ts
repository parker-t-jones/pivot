import { useCallback, useState } from 'react';

/** Markets stays out until Kalshi exists (PIVOT-STAKES-PLAN.md §11.4). */
export const WATCHLIST_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fantasy', label: 'Fantasy' },
  { key: 'bets', label: 'Bets' },
  { key: 'pools', label: 'Pools' },
] as const;

export type WatchlistFilter = (typeof WATCHLIST_FILTERS)[number]['key'];

/** Sections the Watchlist renders for a pill, in order. */
export type WatchlistSection =
  | 'leagueActions'
  | 'leagueChips'
  | 'starters'
  | 'bets'
  | 'pools'
  | 'opponent';

export function watchlistSections(filter: WatchlistFilter): readonly WatchlistSection[] {
  switch (filter) {
    case 'all':
      return ['starters', 'bets', 'opponent'];
    case 'fantasy':
      return ['leagueActions', 'leagueChips', 'starters', 'opponent'];
    case 'bets':
      return ['bets'];
    case 'pools':
      return ['pools'];
  }
}

/** Off keeps today's Lineup screen. On, the tab is the Watchlist. */
export function lineupScreenMode(showBets: boolean): 'watchlist' | 'legacy' {
  return showBets ? 'watchlist' : 'legacy';
}

export function splitBets<T extends { condition: { type: string } }>(
  stakes: readonly T[],
): { bets: T[]; pools: T[] } {
  const bets: T[] = [];
  const pools: T[] = [];
  for (const stake of stakes) {
    if (stake.condition.type === 'SURVIVOR') pools.push(stake);
    else bets.push(stake);
  }
  return { bets, pools };
}

/**
 * Selected pill for this JS session. Survives tab switches because the module stays warm, and
 * resets to All on a cold start. Not AsyncStorage.
 */
let rememberedFilter: WatchlistFilter = 'all';

export function useWatchlistFilter(): [WatchlistFilter, (key: string) => void] {
  const [filter, setFilter] = useState<WatchlistFilter>(rememberedFilter);
  const select = useCallback((key: string) => {
    if (key !== 'all' && key !== 'fantasy' && key !== 'bets' && key !== 'pools') return;
    rememberedFilter = key;
    setFilter(key);
  }, []);
  return [filter, select];
}
