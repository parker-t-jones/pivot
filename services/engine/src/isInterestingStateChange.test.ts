import { describe, expect, it } from 'vitest';
import type { GameState } from '@roster-remote/shared';
import { isInterestingStateChange } from './isInterestingStateChange.js';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game-1',
    homeTeamId: 'A',
    awayTeamId: 'B',
    possessionTeamId: 'A',
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 3,
    quarter: 2,
    timeRemainingSec: 500,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1000,
    ...overrides,
  };
}

describe('isInterestingStateChange', () => {
  it('is interesting when there is no previous state', () => {
    expect(isInterestingStateChange(null, makeState())).toBe(true);
  });

  it('is interesting when possession changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ possessionTeamId: 'B' }))).toBe(true);
  });

  it('is interesting when the unit on the field changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ unitOnField: 'special_teams' }))).toBe(
      true,
    );
  });

  it('is interesting when red-zone status changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ inRedZone: true }))).toBe(true);
  });

  it('is interesting when the home score changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ scoreHome: 14 }))).toBe(true);
  });

  it('is interesting when the away score changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ scoreAway: 10 }))).toBe(true);
  });

  it('is interesting when the quarter changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ quarter: 3 }))).toBe(true);
  });

  it('is interesting when the status changes', () => {
    expect(isInterestingStateChange(makeState(), makeState({ status: 'final' }))).toBe(true);
  });

  it('is NOT interesting when only the clock ticks (timeRemainingSec / updatedAt)', () => {
    const old = makeState({ timeRemainingSec: 500, updatedAt: 1000 });
    const next = makeState({ timeRemainingSec: 480, updatedAt: 2000 });
    expect(isInterestingStateChange(old, next)).toBe(false);
  });

  it('is NOT interesting when nothing changes', () => {
    expect(isInterestingStateChange(makeState(), makeState())).toBe(false);
  });
});
