import { expect, it } from 'vitest';
import { leg } from './fixtures.test-helper.js';
import { scoreImportOutcome } from './importOutcome.js';
import type { SlipLeg } from './schema.js';

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
it('reports refusals, unreadable slips and false accepts before leg scoring', () => {
  const want = { bet_count: 1, legs: [player] };
  expect(scoreImportOutcome({ is_bet_slip: true, bet_count: 6, legs: [player] }, want)).toEqual({
    legs: [],
    slips: ['rejected_multiple_bets'],
  });
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
