import { describe, expect, it } from 'vitest';

import {
  gameTracksKind,
  groupPickGames,
  pickGameAvailability,
  pickGameContextLine,
  pickGameSelectable,
  pickGameStatusLabel,
  playerGame,
  playerResultSubtitle,
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
  it('keeps started and final games on the slate as closed for a survivor pick', () => {
    expect(pickGameAvailability('scheduled', false)).toBe('open');
    expect(pickGameAvailability('in_progress', false)).toBe('started');
    expect(pickGameAvailability('final', false)).toBe('final');
    expect(pickGameSelectable('started')).toBe(false);
    expect(pickGameStatusLabel('started')).toBe('Started');
  });

  it('opens a game in progress to a live bet, labeled Live, and keeps final closed', () => {
    expect(pickGameAvailability('in_progress', true)).toBe('live');
    expect(pickGameSelectable('live')).toBe(true);
    expect(pickGameStatusLabel('live')).toBe('Live');
    expect(pickGameAvailability('final', true)).toBe('final');
    expect(pickGameSelectable('final')).toBe(false);
    expect(pickGameStatusLabel('open')).toBeNull();
  });
});

describe('add a pick player game', () => {
  const games = [
    { game_id: 'g1', status: 'scheduled', home_team: 'SEA', away_team: 'SF' },
    { game_id: 'g2', status: 'in_progress', home_team: 'KC', away_team: 'BUF' },
    { game_id: 'g3', status: 'final', home_team: 'DAL', away_team: 'NYG' },
  ];
  const player = (abbreviation: string | null, position = 'TE') => ({
    position,
    team: abbreviation === null ? null : { abbreviation },
  });

  it("finds the player's game from the team abbreviation, home or away", () => {
    expect(playerGame(player('sf '), games)?.game_id).toBe('g1');
    expect(playerGame(player('KC'), games)?.game_id).toBe('g2');
    expect(playerGame(player('MIA'), games)).toBeNull();
    expect(playerGame(player(null), games)).toBeNull();
  });

  it('says whether the game is open, live, over, or missing', () => {
    expect(playerResultSubtitle(player('SF'), playerGame(player('SF'), games))).toEqual({
      subtitle: 'TE · SF · SF @ SEA',
      disabled: false,
    });
    expect(playerResultSubtitle(player('KC', 'QB'), playerGame(player('KC'), games))).toEqual({
      subtitle: 'QB · KC · BUF @ KC · Live',
      disabled: false,
    });
    expect(playerResultSubtitle(player('DAL'), playerGame(player('DAL'), games))).toEqual({
      subtitle: 'TE · DAL · NYG @ DAL · Final',
      disabled: true,
    });
    expect(playerResultSubtitle(player('MIA', 'WR'), null)).toEqual({
      subtitle: 'WR · MIA · No game this week',
      disabled: true,
    });
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
