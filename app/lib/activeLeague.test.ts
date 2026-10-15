import { describe, expect, it } from 'vitest';

import { resolveActiveLeagueId, watchlistLeagueSelection } from './activeLeague';

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

  it('writes a single watched id only from Set as active', () => {
    expect(watchlistLeagueSelection({ type: 'set-active', leagueId: 'manual' })).toEqual({
      selectedLeagueId: 'manual',
      preferencePatch: { watchedLeagueIds: ['manual'] },
    });
  });
});
