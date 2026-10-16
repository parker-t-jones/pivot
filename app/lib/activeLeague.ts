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

/**
 * True when this league is active. An empty watched list means every league, matching
 * Home's lineup filter. A non-empty list is membership only. No selected league is false.
 */
export function leagueShowsActiveTag(
  leagueId: string | null,
  watchedLeagueIds: readonly string[],
): boolean {
  if (leagueId == null) return false;
  if (watchedLeagueIds.length === 0) return true;
  return watchedLeagueIds.includes(leagueId);
}

/** Tag and watch button for the chip currently on screen. An active league has no button. */
export function watchlistChipCue(input: {
  leagueId: string | null;
  tier: 'free' | 'pro';
  watchedLeagueIds: readonly string[];
}): { showsActiveTag: boolean; watchLabel: 'Set as active' | 'Also watch' | null } {
  const showsActiveTag = leagueShowsActiveTag(input.leagueId, input.watchedLeagueIds);
  if (input.leagueId == null || showsActiveTag) {
    return { showsActiveTag, watchLabel: null };
  }
  return {
    showsActiveTag: false,
    watchLabel: input.tier === 'pro' ? 'Also watch' : 'Set as active',
  };
}

/**
 * Free replaces the watched list with this league. Pro appends it and drops a
 * duplicate. Pro with an empty list writes `[id]`.
 */
export function nextWatchedLeagueIds(input: {
  tier: 'free' | 'pro';
  leagueId: string;
  watchedLeagueIds: readonly string[];
}): string[] {
  if (input.tier === 'pro') {
    if (input.watchedLeagueIds.includes(input.leagueId)) return [...input.watchedLeagueIds];
    return [...input.watchedLeagueIds, input.leagueId];
  }
  return [input.leagueId];
}

export type WatchlistLeagueEvent =
  | {
      type: 'focus';
      leagues: readonly ActiveLeagueRef[];
      watchedLeagueIds: readonly string[];
    }
  | { type: 'chip'; leagueId: string }
  | {
      type: 'set-active';
      leagueId: string;
      tier: 'free' | 'pro';
      watchedLeagueIds: readonly string[];
    };

export interface WatchlistLeagueDecision {
  selectedLeagueId: string | null;
  /**
   * The only Watchlist write. Focus and chip changes leave this null so they
   * cannot call `patchPreferences`.
   */
  preferencePatch: { watchedLeagueIds: string[] } | null;
}

/** Focus snaps back to the active league. A chip only browses. The watch button is the only write. */
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
        preferencePatch: {
          watchedLeagueIds: nextWatchedLeagueIds({
            tier: event.tier,
            leagueId: event.leagueId,
            watchedLeagueIds: event.watchedLeagueIds,
          }),
        },
      };
  }
}
