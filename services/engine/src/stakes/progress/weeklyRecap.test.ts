import type { StakeCondition } from '@pivot/shared';
import { describe, expect, it } from 'vitest';
import { pickMargin, seasonHitRate, weeklyRecap, type RecapPickRow } from './weeklyRecap.js';

const STAT_OVER: StakeCondition = { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 79.5 };
const STAT_UNDER: StakeCondition = { type: 'STAT_UNDER', stat: 'PASS_YDS', line: 250.5 };
const SPREAD: StakeCondition = { type: 'SPREAD', line: -3.5 };
const MONEYLINE: StakeCondition = { type: 'MONEYLINE', side: 'TEAM' };
const SURVIVOR: StakeCondition = { type: 'SURVIVOR' };
const FIRST_TO_SCORE: StakeCondition = { type: 'FIRST_TO_SCORE' };
const FIRST_TD: StakeCondition = { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' };
const ANY_TD: StakeCondition = { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' };

function row(overrides: Partial<RecapPickRow>): RecapPickRow {
  return { id: 'pick-1', condition: STAT_OVER, result: 'won', resultValue: 90, ...overrides };
}

describe('pickMargin', () => {
  it('is the amount an over cleared or missed its line by', () => {
    expect(pickMargin(STAT_OVER, 90)).toBe(90 - 79.5);
    expect(pickMargin(STAT_OVER, 50)).toBe(50 - 79.5);
  });

  it('is the amount an under stayed under or went over its line by', () => {
    expect(pickMargin(STAT_UNDER, 200)).toBe(250.5 - 200);
    expect(pickMargin(STAT_UNDER, 300)).toBe(250.5 - 300);
  });

  it('uses the already-signed margin stored for spread, moneyline, and survivor', () => {
    expect(pickMargin(SPREAD, 7)).toBe(7);
    expect(pickMargin(MONEYLINE, -3)).toBe(-3);
    expect(pickMargin(SURVIVOR, 10)).toBe(10);
  });

  it('measures an any-TD event against its implicit 0.5 line', () => {
    expect(pickMargin(ANY_TD, 1)).toBe(0.5);
    expect(pickMargin(ANY_TD, 0)).toBe(-0.5);
  });

  it('has no margin for a first-to-score or first-TD pick, or with no result value', () => {
    expect(pickMargin(FIRST_TO_SCORE, null)).toBeNull();
    expect(pickMargin(FIRST_TD, null)).toBeNull();
    expect(pickMargin(STAT_OVER, null)).toBeNull();
  });
});

describe('weeklyRecap', () => {
  it('counts every result type from a handful of fixture rows', () => {
    const totals = weeklyRecap([
      row({ id: 'a', result: 'won', resultValue: 90 }),
      row({ id: 'b', result: 'lost', resultValue: 60 }),
      row({ id: 'c', condition: SPREAD, result: 'tie', resultValue: 0 }),
      row({ id: 'd', condition: FIRST_TO_SCORE, result: 'void', resultValue: null }),
    ]);
    expect(totals.picksMade).toBe(4);
    expect(totals.won).toBe(1);
    expect(totals.lost).toBe(1);
    expect(totals.tie).toBe(1);
    expect(totals.voided).toBe(1);
  });

  it('is the hit rate of decided picks only, ties and voids excluded from the denominator', () => {
    const totals = weeklyRecap([
      row({ id: 'a', result: 'won' }),
      row({ id: 'b', result: 'won' }),
      row({ id: 'c', result: 'lost' }),
      row({ id: 'd', condition: SPREAD, result: 'tie', resultValue: 0 }),
      row({ id: 'e', condition: FIRST_TO_SCORE, result: 'void', resultValue: null }),
    ]);
    expect(totals.decided).toBe(3);
    expect(totals.hitRate).toBeCloseTo(2 / 3);
  });

  it('is null with nothing decided yet', () => {
    const totals = weeklyRecap([
      row({ id: 'a', condition: SPREAD, result: 'tie', resultValue: 0 }),
      row({ id: 'b', condition: FIRST_TO_SCORE, result: 'void', resultValue: null }),
    ]);
    expect(totals.decided).toBe(0);
    expect(totals.hitRate).toBeNull();
  });

  it('is empty with no settled picks', () => {
    const totals = weeklyRecap([]);
    expect(totals).toEqual({
      picksMade: 0,
      won: 0,
      lost: 0,
      tie: 0,
      voided: 0,
      decided: 0,
      hitRate: null,
      bestPickId: null,
      worstPickId: null,
    });
  });

  it('picks the won pick with the largest margin as best', () => {
    const totals = weeklyRecap([
      row({ id: 'barely-won', result: 'won', resultValue: 80 }), // margin 0.5
      row({ id: 'crushed-it', result: 'won', resultValue: 140 }), // margin 60.5
      row({ id: 'lost-one', result: 'lost', resultValue: 20 }),
    ]);
    expect(totals.bestPickId).toBe('crushed-it');
  });

  it('picks the lost pick with the largest margin against it as worst', () => {
    const totals = weeklyRecap([
      row({ id: 'barely-lost', result: 'lost', resultValue: 79 }), // margin -0.5
      row({ id: 'blown-out', result: 'lost', resultValue: 10 }), // margin -69.5
      row({ id: 'won-one', result: 'won', resultValue: 90 }),
    ]);
    expect(totals.worstPickId).toBe('blown-out');
  });

  it('falls back to the first won/lost pick when neither carries a margin', () => {
    const totals = weeklyRecap([
      row({ id: 'won-no-margin', condition: FIRST_TO_SCORE, result: 'won', resultValue: null }),
      row({ id: 'lost-no-margin', condition: FIRST_TD, result: 'lost', resultValue: null }),
    ]);
    expect(totals.bestPickId).toBe('won-no-margin');
    expect(totals.worstPickId).toBe('lost-no-margin');
  });

  it('has no best or worst with no wins or no losses', () => {
    expect(weeklyRecap([row({ id: 'a', result: 'won' })]).worstPickId).toBeNull();
    expect(weeklyRecap([row({ id: 'a', result: 'lost' })]).bestPickId).toBeNull();
  });
});

describe('seasonHitRate', () => {
  it('aggregates won and lost across every row passed in', () => {
    const totals = seasonHitRate([
      { result: 'won' },
      { result: 'won' },
      { result: 'lost' },
      { result: 'tie' },
      { result: 'void' },
    ]);
    expect(totals).toEqual({ won: 2, decided: 3, hitRate: 2 / 3 });
  });

  it('is null with nothing decided yet', () => {
    expect(seasonHitRate([])).toEqual({ won: 0, decided: 0, hitRate: null });
    expect(seasonHitRate([{ result: 'void' }, { result: 'tie' }])).toEqual({
      won: 0,
      decided: 0,
      hitRate: null,
    });
  });
});
