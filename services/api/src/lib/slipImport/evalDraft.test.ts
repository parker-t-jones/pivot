import { expect, it } from 'vitest';
import { fromModelRead } from './bets.js';
import { expectedDraft } from './evalDraft.js';
import { normalizeExpected } from './evalScore.js';
import { leg } from './fixtures.test-helper.js';

it('drafts the grouped format with scored fields only, which the loader reads back', () => {
  const ml = leg({ text: 'PHI ML', market: 'MONEYLINE', team: 'PHI', odds: '-110' });
  const read = fromModelRead({
    is_bet_slip: true,
    bet_count: 2,
    // The model's one-leg "parlay" is drafted as a single so the draft is valid ground truth.
    bets: [
      { bet_type: 'parlay', legs: [ml] },
      { bet_type: 'parlay', legs: [ml, ml] },
    ],
  });
  const draft = expectedDraft(read);
  expect(draft).toEqual({
    is_bet_slip: true,
    bets: [
      { bet_type: 'single', legs: [expect.not.objectContaining({ text: 'PHI ML' })] },
      { bet_type: 'parlay', legs: [expect.anything(), expect.anything()] },
    ],
  });
  expect(normalizeExpected(draft).legs[0]).toEqual({
    market: 'MONEYLINE',
    stat: null,
    player: null,
    team: 'PHI',
    side: null,
    line: null,
    plus_style: false,
    period: 'FULL',
  });
});

it('falls back to the flat format when the read has no grouping', () => {
  expect(expectedDraft({ is_bet_slip: true, bet_count: 2, legs: [leg()] })).toMatchObject({
    bet_count: 2,
    legs: [{ market: 'MONEYLINE' }],
  });
});
