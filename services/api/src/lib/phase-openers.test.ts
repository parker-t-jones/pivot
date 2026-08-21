import { describe, expect, it } from 'vitest';
import { deriveDisplayPhase } from './phase-openers.js';
import { etCalendarDateFromUtc } from '@roster-remote/shared';

const PRE = '2026-08-06';
const REG = '2026-09-09';

describe('etCalendarDateFromUtc (night-game regression for /state/nfl openers)', () => {
  it('uses ET calendar day for a Thursday-night regular-season opener', () => {
    expect(etCalendarDateFromUtc('2026-09-10T00:20:00.000Z')).toBe('2026-09-09');
  });

  it('uses ET calendar day for the 2026 preseason / HOF opener', () => {
    expect(etCalendarDateFromUtc('2026-08-07T00:00:00.000Z')).toBe('2026-08-06');
  });
});

describe('deriveDisplayPhase (fixed dates — not the real clock)', () => {
  const openers = { preseasonStart: PRE, regularSeasonStart: REG };

  it('day before preseason_start → off (OFFSEASON)', () => {
    expect(
      deriveDisplayPhase({
        ...openers,
        seasonType: 'pre', // Sleeper already saying pre — must not win
        todayEt: '2026-08-05',
      }),
    ).toBe('off');
  });

  it('day of preseason_start → pre (PRESEASON)', () => {
    expect(
      deriveDisplayPhase({
        ...openers,
        seasonType: 'off',
        todayEt: '2026-08-06',
      }),
    ).toBe('pre');
  });

  it('day before regular_season_start → pre (still PRESEASON)', () => {
    expect(
      deriveDisplayPhase({
        ...openers,
        seasonType: 'regular',
        todayEt: '2026-09-08',
      }),
    ).toBe('pre');
  });

  it('day of regular_season_start → regular (live branch, not idle)', () => {
    expect(
      deriveDisplayPhase({
        ...openers,
        seasonType: 'pre',
        todayEt: '2026-09-09',
      }),
    ).toBe('regular');
  });

  it('falls back to season_type when either opener is null', () => {
    expect(
      deriveDisplayPhase({
        preseasonStart: null,
        regularSeasonStart: REG,
        seasonType: 'pre',
        todayEt: '2026-08-05',
      }),
    ).toBe('pre');
    expect(
      deriveDisplayPhase({
        preseasonStart: PRE,
        regularSeasonStart: null,
        seasonType: 'off',
        todayEt: '2026-08-05',
      }),
    ).toBe('off');
  });

  it("maps today >= regular_season_start to 'regular' even if season_type is 'post'", () => {
    expect(
      deriveDisplayPhase({
        ...openers,
        seasonType: 'post',
        todayEt: '2026-09-09',
      }),
    ).toBe('regular');
  });

  it("'post' is only reachable via null-opener → season_type fallback", () => {
    expect(
      deriveDisplayPhase({
        preseasonStart: null,
        regularSeasonStart: null,
        seasonType: 'post',
        todayEt: '2027-01-15',
      }),
    ).toBe('post');
  });
});
