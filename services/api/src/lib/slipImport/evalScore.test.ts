import { describe, expect, it } from 'vitest';
import type { SlipLeg } from './schema.js';
import { emptyTally, formatTally, scoreSlip, type ExpectedLeg } from './evalScore.js';

const want: ExpectedLeg = {
  market: 'PLAYER_STAT',
  stat: 'REC_YDS',
  player: 'A.J. Brown',
  team: 'PHI',
  side: 'OVER',
  line: 60,
  plus_style: true,
  period: 'FULL',
};
const got = (overrides: Partial<SlipLeg> = {}): SlipLeg => ({
  ...want,
  text: 'A.J. Brown 60+ Receiving Yards',
  matchup: [],
  game_date: null,
  odds: '-120',
  ...overrides,
});

describe('slip eval scoring', () => {
  it('counts each field, ignoring name punctuation and case', () => {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 1, legs: [got({ player: 'AJ brown', line: 59.5 })] },
      { bet_count: 1, legs: [want] },
    );
    expect(tally.fields.player).toEqual({ correct: 1, total: 1 });
    expect(tally.fields.line).toEqual({ correct: 0, total: 1 });
    expect(tally.legCountCorrect).toBe(1);
    expect(formatTally(tally)).toContain('line       0/1 (0.0%)');
  });

  it('scores a dropped leg as wrong on every field', () => {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 1, legs: [got()] },
      { bet_count: 1, legs: [want, { ...want, player: 'Saquon Barkley' }] },
    );
    expect(tally.legCountCorrect).toBe(0);
    expect(tally.fields.market).toEqual({ correct: 1, total: 2 });
  });

  it('defaults the expected is_bet_slip to true when the fixture omits it', () => {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 1, legs: [got()] },
      { bet_count: 1, legs: [want] },
    );
    expect(tally.isBetSlipCorrect).toBe(1);
  });

  it('scores a non-slip image correctly flagged, and wrongly flagged', () => {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: false, bet_count: 0, legs: [] },
      { bet_count: 0, legs: [], is_bet_slip: false },
    );
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 0, legs: [] },
      { bet_count: 0, legs: [], is_bet_slip: false },
    );
    expect(tally.isBetSlipCorrect).toBe(1);
    expect(tally.slips).toBe(2);
    expect(formatTally(tally)).toContain('is_bet_slip right: 1/2 (50.0%)');
  });
});
