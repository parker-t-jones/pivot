import { describe, expect, it } from 'vitest';
import type { SlipLeg } from './schema.js';
import {
  emptyTally,
  formatTally,
  scoreSlip,
  scoreUnordered,
  bestLegAssignment,
  EVAL_TEAMS,
  type ExpectedLeg,
} from './evalScore.js';

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

it('resolves NFL team names and rejects unknown or ambiguous names', () => {
  for (const team of ['DET', 'Lions', 'Detroit Lions']) {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 1, legs: [got({ team })] },
      { bet_count: 1, legs: [{ ...want, team: 'Detroit Lions' }] },
    );
    expect(tally.fields.team.correct).toBe(1);
  }
  for (const team of ['New York', 'unknown']) {
    const tally = emptyTally();
    scoreSlip(
      tally,
      { is_bet_slip: true, bet_count: 1, legs: [got({ team })] },
      { bet_count: 1, legs: [{ ...want, team }] },
    );
    expect(tally.fields.team.correct).toBe(0);
  }
});

it('finds a global assignment for reordered, dropped, duplicate and extra legs', () => {
  expect(EVAL_TEAMS).toHaveLength(32);
  const expected = { bet_count: 1, legs: [want, { ...want, player: 'B', line: 10 }] };
  const read = { is_bet_slip: true, bet_count: 1, legs: [got({ player: 'B', line: 10 }), got()] };
  const positional = emptyTally(),
    unordered = emptyTally();
  scoreSlip(positional, read, expected);
  scoreUnordered(unordered, read, expected);
  expect(positional.fields.player.correct).toBe(0);
  expect(unordered.fields.player.correct).toBe(2);
  const dropped = emptyTally();
  scoreUnordered(dropped, { ...read, legs: read.legs.slice(0, 1) }, expected);
  expect(dropped.fields.player).toEqual({ correct: 1, total: 2 });
  expect(dropped.legCountCorrect).toBe(0);
  const duplicate = emptyTally();
  scoreUnordered(duplicate, { ...read, legs: [got()] }, { bet_count: 1, legs: [want, want] });
  expect(duplicate.fields.player.correct).toBe(1);
  const extra = emptyTally();
  scoreUnordered(extra, { ...read, legs: [...read.legs, got()] }, expected);
  expect(extra.legCountCorrect).toBe(0);
});

it('chooses the global optimum rather than a greedy first-leg match', () => {
  const expected = {
    bet_count: 1,
    legs: [
      { ...want, player: 'A', line: 10, team: 'PHI' },
      { ...want, player: 'B', line: 20, team: 'DET' },
    ],
  };
  const read = {
    is_bet_slip: true,
    bet_count: 1,
    legs: [
      got({ player: 'A', line: 10, team: 'DET' }),
      got({ player: 'A', line: 10, team: 'CHI' }),
    ],
  };
  expect(bestLegAssignment(read, expected)).toEqual([1, 0]);
});

it('keeps the raw scorecard text unchanged when mapper defaults would correct the side', () => {
  const tally = emptyTally();
  scoreSlip(
    tally,
    { is_bet_slip: true, bet_count: 1, legs: [got({ side: null })] },
    { bet_count: 1, legs: [want] },
  );
  expect(formatTally(tally)).toBe(
    [
      'slips: 1',
      'leg count right: 1/1 (100.0%)',
      'bet count right: 1/1 (100.0%)',
      'is_bet_slip right: 1/1 (100.0%)',
      'market     1/1 (100.0%)',
      'stat       1/1 (100.0%)',
      'player     1/1 (100.0%)',
      'team       1/1 (100.0%)',
      'side       0/1 (0.0%)',
      'line       1/1 (100.0%)',
      'plus_style 1/1 (100.0%)',
      'period     1/1 (100.0%)',
    ].join('\n'),
  );
});
