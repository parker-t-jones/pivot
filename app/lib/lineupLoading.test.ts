import { describe, expect, it } from 'vitest';

import {
  clearRememberedWatchlist,
  lineupLoadingMessage,
  readRememberedWatchlist,
  rememberWatchlist,
  showFullLoading,
} from './lineupLoading';

describe('showFullLoading', () => {
  it('shows the full loader only before any lineup exists', () => {
    expect(showFullLoading(false, true)).toBe(true);
    expect(showFullLoading(false, false)).toBe(false);
  });

  it('keeps the current screen while a refocus refetches', () => {
    expect(showFullLoading(true, true)).toBe(false);
    expect(showFullLoading(true, false)).toBe(false);
  });
});

describe('remembered watchlist', () => {
  it('sign-out clears the last known watched leagues', () => {
    clearRememberedWatchlist();
    rememberWatchlist({
      lineup: { league_id: 'espn', week: 6, last_synced_at: null, slots: [] },
      weekGames: null,
      bets: [],
      stakesKnown: false,
      me: null,
      nflWeek: 6,
      watchedStarterTotal: null,
      watchedLeagueIds: ['sleeper'],
    });
    expect(readRememberedWatchlist()?.watchedLeagueIds).toEqual(['sleeper']);
    clearRememberedWatchlist();
    expect(readRememberedWatchlist()).toBeNull();
  });
});

describe('lineupLoadingMessage', () => {
  it('follows the tab name', () => {
    expect(lineupLoadingMessage(true)).toBe('Loading watchlist…');
    expect(lineupLoadingMessage(false)).toBe('Loading lineup…');
  });
});
