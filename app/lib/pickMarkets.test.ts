import { STAT_LINE_RANGE } from '@pivot/shared/picks';
import { describe, expect, it } from 'vitest';

import {
  TEAM_MARKETS,
  defaultPeriod,
  playerHasProps,
  playerMarketsFor,
  statBaseline,
  teamMarketBaseline,
  teamMarketBounds,
  validateHalfLine,
} from './pickMarkets';

describe('player prop markets', () => {
  it('lists the markets that fit the position', () => {
    expect(playerMarketsFor('TE').map((market) => market.label)).toEqual([
      'Receiving yards',
      'Receptions',
      'Anytime TD',
      'First TD',
      'TDs scored',
    ]);
    expect(playerMarketsFor('QB').map((market) => market.key)).toContain('INT_THROWN');
    expect(playerMarketsFor('K').map((market) => market.label)).toEqual([
      'Field goals made',
      'Kicking points',
    ]);
    expect(playerMarketsFor('FB').map((market) => market.key)).toContain('RUSH_YDS');
  });

  it('has no props for a team defense', () => {
    expect(playerHasProps('DEF')).toBe(false);
    expect(playerMarketsFor('DEF')).toEqual([]);
    expect(playerHasProps('WR')).toBe(true);
  });

  it('keeps every baseline inside the range the API accepts, on a half point', () => {
    for (const [stat, range] of Object.entries(STAT_LINE_RANGE)) {
      const baseline = statBaseline(stat as keyof typeof STAT_LINE_RANGE);
      expect(baseline).toBeGreaterThanOrEqual(range.min);
      expect(baseline).toBeLessThanOrEqual(range.max);
      expect(Number.isInteger(baseline * 2)).toBe(true);
    }
  });
});

describe('team and game prop markets', () => {
  it('starts a segment-only market with no period and the rest on the full game', () => {
    for (const market of TEAM_MARKETS) {
      const expected =
        market.periods.length === 0 || market.periods.includes(null) ? null : undefined;
      expect(defaultPeriod(market)).toBe(expected);
    }
    expect(TEAM_MARKETS.find((market) => market.key === 'SEGMENT_SPREAD')?.periods).not.toContain(
      null,
    );
  });

  it('keeps every baseline inside the market range', () => {
    for (const market of TEAM_MARKETS) {
      const bounds = teamMarketBounds(market.key);
      for (const period of market.periods.length > 0 ? market.periods : [null]) {
        const baseline = teamMarketBaseline(market.key, period);
        expect(baseline).toBeGreaterThanOrEqual(bounds.min);
        expect(baseline).toBeLessThanOrEqual(bounds.max);
      }
    }
  });
});

describe('half-point line check', () => {
  it('accepts a half point in range and explains anything else', () => {
    expect(validateHalfLine('6.5', { min: 0.5, max: 10 })).toEqual({ ok: true, line: 6.5 });
    expect(validateHalfLine('', { min: 0.5, max: 10 })).toEqual({
      ok: false,
      message: 'Enter a line.',
    });
    expect(validateHalfLine('abc', { min: 0.5, max: 10 })).toEqual({
      ok: false,
      message: 'Enter a number.',
    });
    expect(validateHalfLine('6.3', { min: 0.5, max: 10 })).toEqual({
      ok: false,
      message: 'Use steps of 0.5.',
    });
    expect(validateHalfLine('10.5', { min: 0.5, max: 10 })).toEqual({
      ok: false,
      message: 'Line must be between 0.5 and 10.',
    });
  });
});
