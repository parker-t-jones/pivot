import type { GameState } from '@fantasy-focus/shared';
import { describe, expect, it } from 'vitest';
import { buildGameSummary } from './gameSummary.js';

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game-1',
    homeTeamId: 'home-team-id',
    awayTeamId: 'away-team-id',
    possessionTeamId: 'home-team-id',
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 7,
    quarter: 3,
    timeRemainingSec: 400,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildGameSummary', () => {
  it('prefers team abbreviations/names from GameSummaryInfo when available', () => {
    const summary = buildGameSummary(makeGameState(), {
      homeTeamAbbreviation: 'KC',
      awayTeamAbbreviation: 'LV',
      homeTeamName: 'Chiefs',
      awayTeamName: 'Raiders',
    });
    expect(summary).toEqual({
      home_team: 'KC',
      away_team: 'LV',
      home_team_name: 'Chiefs',
      away_team_name: 'Raiders',
      score: { home: 14, away: 7 },
      quarter: 3,
      time_remaining_sec: 400,
    });
  });

  it('falls back to raw team ids when GameSummaryInfo is unavailable', () => {
    const summary = buildGameSummary(makeGameState(), null);
    expect(summary.home_team).toBe('home-team-id');
    expect(summary.away_team).toBe('away-team-id');
    expect(summary.home_team_name).toBe('home-team-id');
    expect(summary.away_team_name).toBe('away-team-id');
  });

  it('defaults every field when the GameState itself is unavailable', () => {
    const summary = buildGameSummary(null, null);
    expect(summary).toEqual({
      home_team: '',
      away_team: '',
      home_team_name: '',
      away_team_name: '',
      score: { home: 0, away: 0 },
      quarter: 0,
      time_remaining_sec: 0,
    });
  });
});
