import { describe, expect, it } from 'vitest';

import {
  gameTracksKind,
  groupPickGames,
  pickGameAvailability,
  pickGameContextLine,
  starterCountsByGame,
} from './addPickGames';

describe('add a pick game groups', () => {
  it('uses the home-board windows, then kickoff and away abbreviation', () => {
    const games = [
      { id: 'late', scheduled_start: '2026-09-20T20:25:00Z', away_team: 'LAC' },
      { id: 'thu', scheduled_start: '2026-09-18T00:15:00Z', away_team: 'SEA' },
      { id: 'early-b', scheduled_start: '2026-09-20T17:00:00Z', away_team: 'CHI' },
      { id: 'early-a', scheduled_start: '2026-09-20T17:00:00Z', away_team: 'BAL' },
      { id: 'mon', scheduled_start: '2026-09-22T00:15:00Z', away_team: 'WAS' },
      { id: 'prime', scheduled_start: '2026-09-21T00:20:00Z', away_team: 'DAL' },
      { id: 'bad', scheduled_start: 'not-a-date', away_team: 'AAA' },
    ];
    expect(
      groupPickGames(games).map((group) => [group.label, group.games.map((game) => game.id)]),
    ).toEqual([
      ['THURSDAY NIGHT', ['thu']],
      ['SUNDAY · EARLY', ['early-a', 'early-b']],
      ['SUNDAY · LATE', ['late']],
      ['PRIMETIME', ['prime']],
      ['MONDAY', ['mon']],
    ]);
  });
});

describe('add a pick game availability', () => {
  it('keeps started and final games on the slate as closed', () => {
    expect(pickGameAvailability('scheduled')).toBe('open');
    expect(pickGameAvailability('in_progress')).toBe('started');
    expect(pickGameAvailability('final')).toBe('final');
  });
});

describe('add a pick game context', () => {
  it('counts active-lineup starters in the game and an existing stake of the same type', () => {
    const slots = [
      slot('p1', 'SEA', 'starter', 'QB'),
      slot('p2', 'DEN', 'flex', 'FLEX'),
      slot('p3', 'SEA', 'bench', 'BN'),
      slot('p1', 'SEA', 'starter', 'QB'),
      slot('p4', 'KC', 'starter', 'RB'),
    ];
    const games = [
      { game_id: 'sea', home_team: 'DEN', away_team: 'SEA' },
      { game_id: 'kc', home_team: 'LV', away_team: 'KC' },
    ];
    expect(starterCountsByGame(slots, games).get('sea')).toBe(2);
    expect(starterCountsByGame(slots, games).get('kc')).toBe(1);

    const stakes = [
      { game_id: 'sea', condition: { type: 'MONEYLINE' } },
      { game_id: 'kc', condition: { type: 'TOTAL_UNDER' } },
    ];
    expect(gameTracksKind(stakes, 'sea', 'MONEYLINE')).toBe(true);
    expect(gameTracksKind(stakes, 'sea', 'SPREAD')).toBe(false);
    expect(gameTracksKind(stakes, 'kc', 'TOTAL')).toBe(true);
    expect(pickGameContextLine(2, true, 'MONEYLINE')).toBe(
      '2 of your players · Already tracking ML',
    );
    expect(pickGameContextLine(0, false, 'SPREAD')).toBeNull();
    expect(pickGameContextLine(0, true, 'TOTAL')).toBe('Already tracking total');
  });
});

function slot(id: string, abbreviation: string, slotType: string, position: string) {
  return {
    slot_type: slotType,
    position_in_lineup: position,
    player: { player_id: id, team: { abbreviation } },
  };
}
