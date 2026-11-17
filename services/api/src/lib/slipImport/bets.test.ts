import { describe, expect, it } from 'vitest';
import {
  fromModelRead,
  isInconsistentRead,
  isMultipleBetRead,
  needsReview,
  slipBets,
  slipReadsAgree,
} from './bets.js';
import { leg } from './fixtures.test-helper.js';
import { slipReadSchema, type SlipLeg, type SlipRead } from './schema.js';

const ML = leg({ text: 'PHI ML', market: 'MONEYLINE', team: 'PHI' });
const RUSH = leg({
  text: 'Barkley o84.5',
  market: 'PLAYER_STAT',
  stat: 'RUSH_YDS',
  player: 'Saquon Barkley',
  side: 'OVER',
  line: 84.5,
});
const TOTAL = leg({ market: 'GAME_TOTAL', side: 'UNDER', line: 41.5 });

function grouped(...bets: SlipLeg[][]): SlipRead {
  return fromModelRead({
    is_bet_slip: true,
    bet_count: bets.length,
    bets: bets.map((legs) => ({ bet_type: legs.length > 1 ? 'parlay' : 'single', legs })),
  });
}

describe('fromModelRead and slipBets', () => {
  it('round-trips the grouping through flat legs', () => {
    const read = grouped([ML, RUSH], [TOTAL]);
    expect(read.legs).toEqual([ML, RUSH, TOTAL]);
    expect(slipReadSchema.safeParse(read).success).toBe(true);
    expect(slipBets(read)).toEqual([
      { bet_type: 'parlay', legs: [ML, RUSH] },
      { bet_type: 'single', legs: [TOTAL] },
    ]);
  });

  it('reads a pre-grouping read as one bet, or unknown grouping when it counted several', () => {
    expect(slipBets({ is_bet_slip: true, bet_count: 1, legs: [ML, RUSH] })).toEqual([
      { bet_type: 'parlay', legs: [ML, RUSH] },
    ]);
    expect(slipBets({ is_bet_slip: true, bet_count: 2, legs: [ML, RUSH] })).toBeNull();
  });

  it('rejects a saved read whose bets do not cover its legs', () => {
    const read = { ...grouped([ML], [RUSH]), legs: [ML] };
    expect(slipReadSchema.safeParse(read).success).toBe(false);
  });
});

describe('isMultipleBetRead', () => {
  it.each([
    ['one bet', grouped([ML, RUSH]), false],
    ['two bets', grouped([ML], [RUSH]), true],
    ['a count of two with one group', { ...grouped([ML, RUSH]), bet_count: 2 }, true],
    ['two groups with a count of one', { ...grouped([ML], [RUSH]), bet_count: 1 }, true],
    [
      'an empty second bet',
      fromModelRead({
        is_bet_slip: true,
        bet_count: 1,
        bets: [
          { bet_type: 'single', legs: [ML] },
          { bet_type: 'single', legs: [] },
        ],
      }),
      false,
    ],
    ['not a slip', { is_bet_slip: false, bet_count: 2, legs: [] }, false],
  ])('%s', (_name, read, expected) => {
    expect(isMultipleBetRead(read)).toBe(expected);
  });
});

describe('isInconsistentRead', () => {
  it.each([
    ['consistent', grouped([ML], [RUSH, TOTAL]), false],
    ['count above the groups', { ...grouped([ML], [RUSH]), bet_count: 3 }, true],
    [
      'a one-leg parlay',
      fromModelRead({
        is_bet_slip: true,
        bet_count: 1,
        bets: [{ bet_type: 'parlay', legs: [ML] }],
      }),
      true,
    ],
    [
      'a two-leg single',
      fromModelRead({
        is_bet_slip: true,
        bet_count: 1,
        bets: [{ bet_type: 'single', legs: [ML, RUSH] }],
      }),
      true,
    ],
    [
      'an empty bet',
      fromModelRead({
        is_bet_slip: true,
        bet_count: 2,
        bets: [
          { bet_type: 'single', legs: [ML] },
          { bet_type: 'single', legs: [] },
        ],
      }),
      true,
    ],
    ['unknown grouping', { is_bet_slip: true, bet_count: 2, legs: [ML, RUSH] }, true],
  ])('%s', (_name, read, expected) => {
    expect(isInconsistentRead(read)).toBe(expected);
  });
});

describe('slipReadsAgree (the confirm-pass disagreement rule)', () => {
  const base = grouped([ML], [RUSH, TOTAL]);

  it('ignores bet order, leg order, printed text, odds, and name punctuation', () => {
    const other = grouped(
      [TOTAL, { ...RUSH, text: 'S. Barkley Over', odds: '-115', player: 'saquon barkley.' }],
      [{ ...ML, team: 'phi' }],
    );
    expect(slipReadsAgree(base, other)).toBe(true);
  });

  it.each([
    ['legs regrouped', grouped([ML, RUSH], [TOTAL])],
    ['a leg moved', grouped([ML, RUSH, TOTAL])],
    ['a missing bet', grouped([RUSH, TOTAL])],
    ['a different line', grouped([ML], [{ ...RUSH, line: 85.5 }, TOTAL])],
    ['a different side', grouped([ML], [RUSH, { ...TOTAL, side: 'OVER' }])],
    ['a different stat', grouped([ML], [{ ...RUSH, stat: 'REC_YDS' }, TOTAL])],
    ['a different period', grouped([ML], [RUSH, { ...TOTAL, period: 'H1' }])],
    ['a team written another way', grouped([{ ...ML, team: 'Eagles' }], [RUSH, TOTAL])],
    ['an inconsistent count', { ...grouped([ML], [RUSH, TOTAL]), bet_count: 3 }],
    ['not a slip', { is_bet_slip: false, bet_count: 0, legs: [] }],
  ])('disagrees on %s', (_name, other) => {
    expect(slipReadsAgree(base, other)).toBe(false);
  });
});

describe('needsReview', () => {
  it.each([
    [undefined, false],
    ['agreed', false],
    ['disagreed', true],
    ['failed', true],
  ] as const)('confirmation %s → %s', (confirmation, expected) => {
    const read = grouped([ML], [RUSH]);
    expect(needsReview(confirmation ? { ...read, confirmation } : read)).toBe(expected);
  });

  it('reviews an inconsistent read even when the reads agreed', () => {
    expect(needsReview({ ...grouped([ML], [RUSH]), bet_count: 5, confirmation: 'agreed' })).toBe(
      true,
    );
  });
});
