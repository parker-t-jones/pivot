import { describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import { deserializeGameState, serializeGameState } from './redisSerde.js';

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g1',
    homeTeamId: 'home',
    awayTeamId: 'away',
    possessionTeamId: 'home',
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 7,
    quarter: 2,
    timeRemainingSec: 500,
    yardsToOpponentEndzone: 32,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('serializeGameState / deserializeGameState', () => {
  it('round-trips a fully populated game state', () => {
    const state = makeGameState();
    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
  });

  it('round-trips null yardline/down/distance as empty strings', () => {
    const state = makeGameState({
      possessionTeamId: null,
      yardsToOpponentEndzone: null,
      down: null,
      distance: null,
      unitOnField: 'none',
    });
    const raw = serializeGameState(state);
    expect(raw['yards_to_opponent_endzone']).toBe('');
    expect(raw['down']).toBe('');
    expect(raw['distance']).toBe('');
    expect(deserializeGameState(raw)).toEqual(state);
  });

  it('coerces numeric hash values from Upstash JSON parsing', () => {
    const state = deserializeGameState({
      game_id: 'g1',
      home_team_id: 'home',
      away_team_id: 'away',
      possession_team_id: 'home',
      unit_on_field: 'offense',
      score_home: 14,
      score_away: 7,
      quarter: 2,
      time_remaining_sec: 500,
      yards_to_opponent_endzone: 32,
      down: 3,
      distance: 7,
      in_red_zone: 1,
      status: 'in_progress',
      updated_at: 1_700_000_000_000,
    });
    expect(state.yardsToOpponentEndzone).toBe(32);
    expect(state.down).toBe(3);
    expect(state.distance).toBe(7);
    expect(state.inRedZone).toBe(true);
  });
});
