import { describe, expect, it } from 'vitest';
import { fromModelRead } from './bets.js';
import { normalizeExpected } from './evalScore.js';
import { leg } from './fixtures.test-helper.js';
import {
  addImportOutcome,
  emptyImportTally,
  scoreGrouping,
  scoreImportOutcome,
} from './importOutcome.js';
import type { SlipLeg, SlipRead } from './schema.js';

const player = leg({
  market: 'PLAYER_STAT',
  player: 'Saquon Barkley',
  stat: 'RUSH_YDS',
  side: 'OVER',
  line: 20,
  plus_style: true,
  team: 'PHI',
});
const outcome = (got: SlipLeg, want: SlipLeg = player) =>
  scoreImportOutcome(
    { is_bet_slip: true, bet_count: 1, legs: [got] },
    { bet_count: 1, legs: [want] },
  ).legs[0];

it('uses the mapper for plus-style and anytime-TD side defaults', () => {
  expect(outcome({ ...player, side: null })).toMatchObject({ outcome: 'match' });
  const td = leg({ market: 'ANYTIME_TD', player: 'Saquon Barkley', team: 'PHI', side: 'YES' });
  expect(outcome({ ...td, side: null }, td)).toMatchObject({ outcome: 'match' });
  expect(outcome({ ...td, side: 'OVER' }, td)).toMatchObject({ outcome: 'flagged' });
});
it('counts wrong side, line, stat, period and market as silently wrong', () => {
  const want = { ...player, plus_style: false, side: 'UNDER' as const };
  for (const change of [
    { side: 'OVER' as const },
    { line: 21 },
    { stat: 'REC_YDS' as const },
    { market: 'ANYTIME_TD' as const, side: null },
  ])
    expect(outcome({ ...want, ...change }, want)?.outcome).toBe('silent_wrong');
  const total = leg({ market: 'GAME_TOTAL', side: 'OVER', line: 40 });
  expect(outcome({ ...total, period: 'H1' }, total)?.outcome).toBe('silent_wrong');
});
it('keeps player team differences informational and separates blank and different', () => {
  expect(outcome({ ...player, team: null })).toMatchObject({
    outcome: 'match',
    team_differs: 'blank',
  });
  expect(outcome({ ...player, team: 'KC' })).toMatchObject({
    outcome: 'match',
    team_differs: 'different',
  });
  expect(outcome({ ...player, team: 'Unknown' })).toMatchObject({
    outcome: 'match',
    team_differs: 'different',
  });
  expect(outcome({ ...player, team: 'Eagles' })?.team_differs).toBeNull();
  expect(outcome({ ...player, team: 'KC' }, { ...player, team: null })?.team_differs).toBeNull();
});
it.each(['MONEYLINE', 'SPREAD', 'TEAM_TOTAL'] as const)(
  'requires a resolvable correct team on %s',
  (market) => {
    const want = leg({ market, team: 'PHI', side: 'OVER', line: 3 });
    for (const team of [null, 'New York', 'Unknown'])
      expect(outcome({ ...want, team }, want)?.outcome).toBe('flagged');
    expect(outcome({ ...want, team: 'KC' }, want)?.outcome).toBe('silent_wrong');
    expect(outcome({ ...want, team: 'Eagles' }, want)?.outcome).toBe('match');
  },
);
it('reports unreadable slips and false accepts before leg scoring', () => {
  const want = { bet_count: 1, legs: [player] };
  expect(scoreImportOutcome({ is_bet_slip: false, bet_count: 0, legs: [] }, want).slips).toEqual([
    'unreadable',
  ]);
  expect(scoreImportOutcome({ is_bet_slip: true, bet_count: 1, legs: [] }, want).slips).toEqual([
    'unreadable',
  ]);
  expect(
    scoreImportOutcome(
      { is_bet_slip: true, bet_count: 1, legs: [player] },
      { is_bet_slip: false, bet_count: 0, legs: [] },
    ).slips,
  ).toEqual(['false_accept']);
});
it('keeps unsupported reads flagged and ready reads against unsupported expectations wrong', () => {
  const unsupported = leg({ market: 'OTHER' });
  expect(outcome(player, unsupported)?.outcome).toBe('silent_wrong');
  expect(outcome(unsupported, unsupported)?.outcome).toBe('flagged');
  expect(
    scoreImportOutcome(
      { is_bet_slip: true, bet_count: 1, legs: [player] },
      { bet_count: 1, legs: [player, player] },
    ).legs.map((l) => l.outcome),
  ).toEqual(['match', 'flagged']);
  expect(
    scoreImportOutcome(
      { is_bet_slip: true, bet_count: 1, legs: [player, player] },
      { bet_count: 1, legs: [player] },
    ).legs.map((l) => l.outcome),
  ).toEqual(['match', 'silent_wrong']);
});

describe('multi-bet import outcomes', () => {
  const ml = leg({ market: 'MONEYLINE', team: 'PHI' });
  const total = leg({ market: 'GAME_TOTAL', side: 'UNDER', line: 41.5 });
  function grouped(...bets: SlipLeg[][]): SlipRead {
    return fromModelRead({
      is_bet_slip: true,
      bet_count: bets.length,
      bets: bets.map((legs) => ({
        bet_type: legs.length > 1 ? ('parlay' as const) : ('single' as const),
        legs,
      })),
    });
  }
  const expected = (...bets: SlipLeg[][]) =>
    normalizeExpected({
      bets: bets.map((legs) => ({ bet_type: legs.length > 1 ? 'parlay' : 'single', legs })),
    });

  it('keeps the legacy refusal as an annotation and still scores the legs', () => {
    const got = { is_bet_slip: true, bet_count: 6, legs: [player] };
    expect(scoreImportOutcome(got, { bet_count: 1, legs: [player] })).toMatchObject({
      legs: [{ outcome: 'match' }],
      slips: ['rejected_multiple_bets'],
    });
    // A phantom split of a single parlay is a refusal for legacy clients...
    const split = scoreImportOutcome(grouped([player], [ml]), expected([player, ml]));
    expect(split.slips).toEqual(['rejected_multiple_bets', 'silent_wrong_grouping']);
    expect(split.grouping).toBe('wrong');
  });

  it('does not count a real multi-bet slip as a refusal', () => {
    const outcome = scoreImportOutcome(
      grouped([player], [ml, total]),
      expected([player], [ml, total]),
    );
    expect(outcome).toMatchObject({ slips: [], grouping: 'correct', multi_bet: true });
    expect(outcome.legs.map((l) => l.outcome)).toEqual(['match', 'match', 'match']);
  });

  it('finds the grouping regardless of bet order', () => {
    expect(scoreGrouping(grouped([ml, total], [player]), expected([player], [ml, total]))).toBe(
      'correct',
    );
  });

  it.each([
    ['merged bets', grouped([player, ml, total])],
    ['a leg in the wrong bet', grouped([player, ml], [total])],
    ['a missing leg', grouped([player], [ml])],
  ])('marks %s as wrong grouping', (_name, got) => {
    expect(scoreGrouping(got, expected([player], [ml, total]))).toBe('wrong');
  });

  it('has unknown grouping for a flat multi-bet expected file or a pre-grouping read', () => {
    expect(scoreGrouping(grouped([player], [ml]), { bet_count: 2, legs: [player, ml] })).toBeNull();
    expect(
      scoreGrouping(
        { is_bet_slip: true, bet_count: 2, legs: [player, ml] },
        expected([player], [ml]),
      ),
    ).toBeNull();
    expect(scoreGrouping(grouped([player, ml]), { bet_count: 1, legs: [player, ml] })).toBe(
      'correct',
    );
  });

  it('turns silent errors into flagged legs and no grouping error in review', () => {
    const got = grouped([{ ...player, line: 99 }, ml]);
    const want = expected([player], [ml]);
    expect(scoreImportOutcome(got, want).legs[0]?.outcome).toBe('silent_wrong');
    expect(scoreImportOutcome(got, want).slips).toContain('silent_wrong_grouping');
    const reviewed = scoreImportOutcome(got, want, { review: true });
    expect(reviewed.legs[0]?.outcome).toBe('flagged');
    expect(reviewed.slips).not.toContain('silent_wrong_grouping');
    expect(reviewed).toMatchObject({ review: true, grouping: 'wrong' });
  });

  it('tallies review, grouping and multi-bet grouping accuracy', () => {
    const tally = emptyImportTally();
    addImportOutcome(tally, scoreImportOutcome(grouped([player], [ml]), expected([player], [ml])));
    addImportOutcome(
      tally,
      scoreImportOutcome(grouped([player, ml]), expected([player], [ml]), { review: true }),
    );
    addImportOutcome(tally, scoreImportOutcome(grouped([player]), expected([player])));
    expect(tally).toMatchObject({
      review: 1,
      grouping_correct: 2,
      grouping_wrong: 1,
      silent_wrong_grouping: 0,
      multi_bet_slips: 2,
      multi_bet_grouping_correct: 1,
    });
  });
});

describe('normalizeExpected', () => {
  const ml = leg({ market: 'MONEYLINE', team: 'PHI' });

  it('keeps the flat format unchanged', () => {
    expect(normalizeExpected({ bet_count: 1, legs: [ml] })).toEqual({ bet_count: 1, legs: [ml] });
    expect(normalizeExpected({ bet_count: 0, legs: [], is_bet_slip: false })).toEqual({
      bet_count: 0,
      legs: [],
      is_bet_slip: false,
    });
  });

  it('flattens the grouped format and records each bet’s span', () => {
    expect(
      normalizeExpected({
        bets: [
          { bet_type: 'parlay', legs: [ml, player] },
          { bet_type: 'single', legs: [ml] },
        ],
      }),
    ).toEqual({
      bet_count: 2,
      legs: [ml, player, ml],
      bets: [
        { bet_type: 'parlay', leg_count: 2 },
        { bet_type: 'single', leg_count: 1 },
      ],
    });
  });

  it.each([
    ['both formats', { bets: [], legs: [], bet_count: 0 }],
    ['a bad bet type', { bets: [{ bet_type: 'teaser', legs: [ml] }] }],
    ['an empty bet', { bets: [{ bet_type: 'single', legs: [] }] }],
    ['a one-leg parlay', { bets: [{ bet_type: 'parlay', legs: [ml] }] }],
    ['a mismatched count', { bet_count: 3, bets: [{ bet_type: 'single', legs: [ml] }] }],
    ['a flat file with no count', { legs: [ml] }],
    ['not an object', 'nope'],
  ])('rejects %s', (_name, raw) => {
    expect(() => normalizeExpected(raw, 'x.expected.json')).toThrow(/^x\.expected\.json: /);
  });
});
