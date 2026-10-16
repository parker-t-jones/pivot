import { describe, expect, it } from 'vitest';

import {
  leagueShowsActiveTag,
  nextWatchedLeagueIds,
  resolveActiveLeagueId,
  watchlistLeagueSelection,
} from './activeLeague';

const leagues = [{ league_id: 'espn' }, { league_id: 'sleeper' }, { league_id: 'manual' }];

describe('resolveActiveLeagueId', () => {
  it('uses the first league when nothing is watched', () => {
    expect(resolveActiveLeagueId(leagues, [])).toBe('espn');
  });

  it('uses the first league when every watched id is missing', () => {
    expect(resolveActiveLeagueId(leagues, ['gone'])).toBe('espn');
  });

  it('keeps list order when two leagues are watched', () => {
    expect(resolveActiveLeagueId(leagues, ['manual', 'sleeper'])).toBe('sleeper');
    expect(resolveActiveLeagueId(leagues, ['sleeper', 'espn'])).toBe('espn');
  });

  it('returns null when there are no leagues', () => {
    expect(resolveActiveLeagueId([], ['espn'])).toBeNull();
    expect(resolveActiveLeagueId([], [])).toBeNull();
  });
});

describe('watchlistLeagueSelection', () => {
  it('resets to the active league on focus and does not write', () => {
    expect(
      watchlistLeagueSelection({
        type: 'focus',
        leagues,
        watchedLeagueIds: ['sleeper'],
      }),
    ).toEqual({
      selectedLeagueId: 'sleeper',
      preferencePatch: null,
    });
  });

  it('keeps a chip change local', () => {
    expect(watchlistLeagueSelection({ type: 'chip', leagueId: 'manual' })).toEqual({
      selectedLeagueId: 'manual',
      preferencePatch: null,
    });
  });

  it('writes the tier-specific watched list only from the watch button', () => {
    expect(
      watchlistLeagueSelection({
        type: 'set-active',
        leagueId: 'manual',
        tier: 'free',
        watchedLeagueIds: ['espn', 'sleeper'],
      }),
    ).toEqual({
      selectedLeagueId: 'manual',
      preferencePatch: { watchedLeagueIds: ['manual'] },
    });
  });
});

describe('leagueShowsActiveTag', () => {
  it('is on only for a league in the watched list', () => {
    expect(leagueShowsActiveTag('sleeper', ['espn', 'sleeper'])).toBe(true);
    expect(leagueShowsActiveTag('manual', ['espn', 'sleeper'])).toBe(false);
    expect(leagueShowsActiveTag('espn', [])).toBe(false);
    expect(leagueShowsActiveTag(null, ['espn'])).toBe(false);
  });
});

describe('nextWatchedLeagueIds', () => {
  it('replaces the list for Free', () => {
    expect(
      nextWatchedLeagueIds({
        tier: 'free',
        leagueId: 'manual',
        watchedLeagueIds: ['espn', 'sleeper'],
      }),
    ).toEqual(['manual']);
  });

  it('appends for Pro and drops a duplicate', () => {
    expect(
      nextWatchedLeagueIds({
        tier: 'pro',
        leagueId: 'manual',
        watchedLeagueIds: ['espn', 'sleeper'],
      }),
    ).toEqual(['espn', 'sleeper', 'manual']);
    expect(
      nextWatchedLeagueIds({
        tier: 'pro',
        leagueId: 'sleeper',
        watchedLeagueIds: ['espn', 'sleeper'],
      }),
    ).toEqual(['espn', 'sleeper']);
  });

  it('writes a single id when Pro has nothing watched yet', () => {
    expect(
      nextWatchedLeagueIds({ tier: 'pro', leagueId: 'manual', watchedLeagueIds: [] }),
    ).toEqual(['manual']);
  });
});
