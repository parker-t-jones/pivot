import { describe, expect, it } from 'vitest';

import { buildStakeRequest, validateLine, type ManualStakeType } from './stakes';
import {
  SPREAD_LINE_BOUNDS,
  TOTAL_LINE_BOUNDS,
  addPickReviewNote,
  spreadLineInput,
  spreadReadout,
  stepMagnitude,
  totalReadout,
  type SpreadRole,
} from './addPickLine';

const GAME = 'game-1';
const TEAM = 'team-sea';

function request(type: ManualStakeType, input: string, teamId?: string) {
  const check = validateLine(type, input);
  if (!check.ok) throw new Error(check.message);
  return buildStakeRequest({
    type,
    gameId: GAME,
    ...(teamId ? { teamId } : {}),
    ...(check.line !== undefined ? { line: check.line } : {}),
  });
}

describe('add a pick line payload', () => {
  it('sends the same stake as the old sign toggle', () => {
    const cases: { role: SpreadRole; magnitude: string; old: string }[] = [
      { role: 'favorite', magnitude: '3.5', old: '-3.5' },
      { role: 'favorite', magnitude: '3', old: '-3' },
      { role: 'underdog', magnitude: '3.5', old: '+3.5' },
      { role: 'underdog', magnitude: '3', old: '+3' },
    ];
    for (const entry of cases) {
      expect(request('SPREAD', spreadLineInput(entry.role, entry.magnitude), TEAM)).toEqual(
        request('SPREAD', entry.old, TEAM),
      );
    }
    expect(request('TOTAL_OVER', '47.5')).toEqual(request('TOTAL_OVER', '47.5'));
    expect(request('TOTAL_UNDER', '47.5')).toEqual(request('TOTAL_UNDER', '47.5'));
    expect(request('TOTAL_OVER', '47')).toEqual(request('TOTAL_OVER', '47'));
    expect(request('TOTAL_UNDER', '47')).toEqual(request('TOTAL_UNDER', '47'));
    expect(request('SPREAD', spreadLineInput('favorite', '3.5'), TEAM)).toEqual({
      type: 'SPREAD',
      gameId: GAME,
      teamId: TEAM,
      line: -3.5,
    });
    expect(request('SPREAD', spreadLineInput('underdog', '3'), TEAM).line).toBe(3);
    expect(request('TOTAL_OVER', '47').line).toBe(47);
  });
});

describe('add a pick readout', () => {
  it('names the cover and the push', () => {
    expect(spreadReadout('Seahawks', 'favorite', 3.5)).toBe('Seahawks must win by 4+');
    expect(spreadReadout('Seahawks', 'favorite', 3)).toBe(
      'Seahawks must win by 4+ (push if they win by 3)',
    );
    expect(spreadReadout('Seahawks', 'underdog', 3.5)).toBe(
      'Seahawks can lose by 3 or less, or win',
    );
    expect(spreadReadout('Seahawks', 'underdog', 3)).toBe(
      'Seahawks can lose by 2 or less, or win (push at 3)',
    );
    expect(totalReadout('over', 47.5)).toBe('Combined score must be 48+');
    expect(totalReadout('under', 47.5)).toBe('47 or fewer');
    expect(totalReadout('over', 47)).toBe('Combined score must be 48+ (push at 47)');
    expect(totalReadout('under', 47)).toBe('46 or fewer (push at 47)');
  });
});

describe('add a pick stepper', () => {
  it('stays inside the spread and total ranges', () => {
    expect(stepMagnitude('', 1, SPREAD_LINE_BOUNDS)).toBe('0.5');
    expect(stepMagnitude('', -1, SPREAD_LINE_BOUNDS)).toBe('');
    expect(stepMagnitude('0.5', -1, SPREAD_LINE_BOUNDS)).toBe('0');
    expect(stepMagnitude('0', -1, SPREAD_LINE_BOUNDS)).toBe('0');
    expect(stepMagnitude('50', 1, SPREAD_LINE_BOUNDS)).toBe('50');
    expect(stepMagnitude('49.5', 1, SPREAD_LINE_BOUNDS)).toBe('50');
    expect(stepMagnitude('', 1, TOTAL_LINE_BOUNDS)).toBe('10');
    expect(stepMagnitude('10', -1, TOTAL_LINE_BOUNDS)).toBe('10');
    expect(stepMagnitude('100', 1, TOTAL_LINE_BOUNDS)).toBe('100');
    expect(stepMagnitude('9.5', 1, TOTAL_LINE_BOUNDS)).toBe('10');
  });
});

describe('add a pick review note', () => {
  it('counts a free bet and skips the count for survivor and Pro', () => {
    expect(addPickReviewNote('SPREAD', { isPro: false, freeLeft: 2 })).toBe(
      'Uses 1 of your 2 free bets',
    );
    expect(addPickReviewNote('SURVIVOR', { isPro: false, freeLeft: 2 })).toBe(
      "Doesn't use a free bet",
    );
    expect(addPickReviewNote('SPREAD', { isPro: true, freeLeft: null })).toBeNull();
    expect(addPickReviewNote('TOTAL', { isPro: false, freeLeft: null })).toBeNull();
  });
});
