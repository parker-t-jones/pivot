import { describe, expect, it } from 'vitest';
import {
  assembleUserLineupCache,
  diffLineupCaches,
} from '../services/api/src/lib/lineupCacheAssemble.js';
import { parseCompareArgs } from './compare-caches.js';
import { RemoteSafetyError } from './remoteSafety.js';

describe('compare-caches', () => {
  it('reads optional season and week', () => {
    expect(parseCompareArgs([])).toEqual({ season: null, week: null });
    expect(parseCompareArgs(['--season', '2026', '--week', '1'])).toEqual({
      season: 2026,
      week: 1,
    });
  });

  it('rejects an unknown argument', () => {
    expect(() => parseCompareArgs(['--apply'])).toThrow(RemoteSafetyError);
  });

  it('ignores map insertion order when the caches match', () => {
    const left = assembleUserLineupCache('user', 1, [
      { playerId: 'a', teamId: 'phi', position: 'WR', star: true, leagueId: 'league-a' },
      { playerId: 'b', teamId: 'chi', position: 'DEF', star: false, leagueId: 'league-a' },
    ]);
    const right = assembleUserLineupCache('user', 1, [
      { playerId: 'b', teamId: 'chi', position: 'DEF', star: false, leagueId: 'league-a' },
      { playerId: 'a', teamId: 'phi', position: 'WR', star: true, leagueId: 'league-a' },
    ]);
    expect(
      diffLineupCaches(
        left,
        right,
        new Map([
          ['a', 'league-a'],
          ['b', 'league-a'],
        ]),
      ),
    ).toEqual([]);
  });
});
