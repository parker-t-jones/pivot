import { describe, expect, it } from 'vitest';
import { formatPickLabel, formatStakeLabel, shortPlayerName } from './stakeLabel.js';

const teams = [
  { teamId: 'atl', abbreviation: 'ATL' },
  { teamId: 'gb', abbreviation: 'GB' },
];
const atl = { type: 'TEAM', teamId: 'atl' };
const game = { type: 'GAME' };

describe('formatPickLabel', () => {
  it('reads the existing four types exactly like formatStakeLabel', () => {
    for (const condition of [
      { type: 'SPREAD', line: -3.5 },
      { type: 'TOTAL_OVER', line: 47.5 },
      { type: 'MONEYLINE' },
      { type: 'SURVIVOR' },
    ]) {
      const subject = condition.type === 'TOTAL_OVER' ? game : atl;
      expect(formatPickLabel({ condition, subject }, teams)).toBe(
        formatStakeLabel({ condition, subject }, teams),
      );
    }
  });

  it('labels player props with the player and stat', () => {
    const subject = { type: 'PLAYER' };
    expect(
      formatPickLabel(
        {
          condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 },
          subject,
          playerName: 'B. Robinson',
        },
        teams,
      ),
    ).toBe('B. Robinson over 89.5 rush yds');
    expect(
      formatPickLabel(
        {
          condition: { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' },
          subject,
          playerName: 'C. Watson',
        },
        teams,
      ),
    ).toBe('C. Watson first TD');
    expect(
      formatPickLabel(
        {
          condition: { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'NO' },
          subject,
          playerName: 'J. Love',
        },
        teams,
      ),
    ).toBe('J. Love no TD');
  });

  it('labels team, segment, and FG props', () => {
    expect(
      formatPickLabel({ condition: { type: 'TEAM_TOTAL_OVER', line: 24.5 }, subject: atl }, teams),
    ).toBe('ATL team total over 24.5');
    expect(
      formatPickLabel(
        { condition: { type: 'SPREAD', line: -3.5, segment: 'H1' }, subject: atl },
        teams,
      ),
    ).toBe('ATL 1H −3.5');
    expect(
      formatPickLabel(
        { condition: { type: 'TOTAL_UNDER', line: 10.5, segment: 'Q1' }, subject: game },
        teams,
      ),
    ).toBe('1Q Under 10.5');
    expect(formatPickLabel({ condition: { type: 'FIRST_TO_SCORE' }, subject: atl }, teams)).toBe(
      'ATL to score first',
    );
    expect(
      formatPickLabel({ condition: { type: 'FG_OVER', line: 3.5 }, subject: game }, teams),
    ).toBe('Total FGs over 3.5');
  });

  it('shortens a name to an initial and last name', () => {
    expect(shortPlayerName('Bijan', 'Robinson')).toBe('B. Robinson');
    expect(shortPlayerName('', 'Robinson')).toBe('Robinson');
  });
});
