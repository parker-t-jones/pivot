import { describe, expect, it } from 'vitest';
import type { GameState } from './types.js';
import { resolvePossessionAbbreviation } from './possessionAbbreviation.js';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g1',
    homeTeamId: 'home-id',
    awayTeamId: 'away-id',
    possessionTeamId: 'home-id',
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    timeRemainingSec: 900,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

describe('resolvePossessionAbbreviation', () => {
  it('returns the home abbreviation when the home team has the ball', () => {
    expect(resolvePossessionAbbreviation(makeState(), 'KC', 'LV')).toBe('KC');
  });

  it('returns the away abbreviation when the away team has the ball', () => {
    expect(
      resolvePossessionAbbreviation(makeState({ possessionTeamId: 'away-id' }), 'KC', 'LV'),
    ).toBe('LV');
  });

  it('returns null when there is no possession', () => {
    expect(
      resolvePossessionAbbreviation(makeState({ possessionTeamId: null }), 'KC', 'LV'),
    ).toBeNull();
  });

  it('returns null when game state is missing', () => {
    expect(resolvePossessionAbbreviation(null, 'KC', 'LV')).toBeNull();
  });

  it('returns null when the possession id matches neither side', () => {
    expect(
      resolvePossessionAbbreviation(makeState({ possessionTeamId: 'other' }), 'KC', 'LV'),
    ).toBeNull();
  });
});
