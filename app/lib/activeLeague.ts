/**
 * Which league Home and Watchlist treat as active.
 *
 * List order is `GET /leagues` (`created_at` ascending). The first row whose id is
 * in `watchedLeagueIds` wins. An empty watched list, or ids that are not in the
 * list, falls through to the first league. No leagues is null.
 *
 * Home still shows the "ACTIVE LINEUP" placeholder when `watchedLeagueIds` is
 * empty. That is a label, not a different id: this function still returns
 * `leagues[0]` so both screens agree.
 */
export interface ActiveLeagueRef {
  league_id: string;
}

export function resolveActiveLeagueId(
  leagues: readonly ActiveLeagueRef[],
  watchedLeagueIds: readonly string[],
): string | null {
  const watched = new Set(watchedLeagueIds);
  const match = leagues.find((league) => watched.has(league.league_id));
  return match?.league_id ?? leagues[0]?.league_id ?? null;
}

export type WatchlistLeagueEvent =
  | {
      type: 'focus';
      leagues: readonly ActiveLeagueRef[];
      watchedLeagueIds: readonly string[];
    }
  | { type: 'chip'; leagueId: string }
  | { type: 'set-active'; leagueId: string };

export interface WatchlistLeagueDecision {
  selectedLeagueId: string | null;
  /**
   * The only Watchlist write. Focus and chip changes leave this null so they
   * cannot call `patchPreferences`.
   */
  preferencePatch: { watchedLeagueIds: string[] } | null;
}

/** Focus snaps back to the active league. A chip only browses. Set as active writes one id. */
export function watchlistLeagueSelection(event: WatchlistLeagueEvent): WatchlistLeagueDecision {
  switch (event.type) {
    case 'focus':
      return {
        selectedLeagueId: resolveActiveLeagueId(event.leagues, event.watchedLeagueIds),
        preferencePatch: null,
      };
    case 'chip':
      return { selectedLeagueId: event.leagueId, preferencePatch: null };
    case 'set-active':
      return {
        selectedLeagueId: event.leagueId,
        preferencePatch: { watchedLeagueIds: [event.leagueId] },
      };
  }
}
