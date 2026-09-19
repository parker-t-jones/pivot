import { describe, expect, it } from 'vitest';
import type { FlaggedPlayer, GameSummary } from './flagEventPayload';
import {
  reasonChipCopy,
  reasonChipParts,
  resolveFlaggedTeamDisplay,
  resolvePossessingTeamDisplay,
  type PlayerTeamMap,
} from './teamDisplay';

function game(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    home_team: 'IND',
    away_team: 'DEN',
    home_team_name: 'Colts',
    away_team_name: 'Broncos',
    home_team_primary_color: '#002C5F',
    home_team_secondary_color: '#A2AAAD',
    away_team_primary_color: '#FB4F14',
    away_team_secondary_color: '#002244',
    score: { home: 14, away: 10 },
    quarter: 3,
    time_remaining_sec: 434,
    possession_team: null,
    yards_to_endzone: null,
    down: null,
    distance: null,
    in_red_zone: false,
    ...overrides,
  };
}

const jonathanTaylor: FlaggedPlayer = {
  player_id: 'p-1',
  first_name: 'Jonathan',
  last_name: 'Taylor',
  position: 'RB',
};

describe('resolvePossessingTeamDisplay', () => {
  it('returns null when there is no possession', () => {
    expect(resolvePossessingTeamDisplay(game(), null)).toBeNull();
  });

  it('resolves the home team by abbreviation', () => {
    const result = resolvePossessingTeamDisplay(game(), 'IND');
    expect(result).toEqual({
      name: 'Colts',
      abbreviation: 'IND',
      primaryColor: '#002C5F',
      secondaryColor: '#A2AAAD',
    });
  });

  it('resolves the away team by abbreviation', () => {
    const result = resolvePossessingTeamDisplay(game(), 'DEN');
    expect(result?.name).toBe('Broncos');
    expect(result?.primaryColor).toBe('#FB4F14');
  });

  it('returns null for an abbreviation matching neither side', () => {
    expect(resolvePossessingTeamDisplay(game(), 'KC')).toBeNull();
  });
});

describe('resolveFlaggedTeamDisplay', () => {
  it('resolves the flagged team via the player->team map', () => {
    const map: PlayerTeamMap = new Map([
      ['p-1', { teamId: 't-1', abbreviation: 'IND', name: 'Colts' }],
    ]);
    const result = resolveFlaggedTeamDisplay(game(), [jonathanTaylor], map);
    expect(result?.name).toBe('Colts');
    expect(result?.abbreviation).toBe('IND');
  });

  it('falls through to the next flagged player if the first has no map entry', () => {
    const secondPlayer: FlaggedPlayer = {
      player_id: 'p-2',
      first_name: 'Courtland',
      last_name: 'Sutton',
      position: 'WR',
    };
    const map: PlayerTeamMap = new Map([
      ['p-2', { teamId: 't-2', abbreviation: 'DEN', name: 'Broncos' }],
    ]);
    const result = resolveFlaggedTeamDisplay(game(), [jonathanTaylor, secondPlayer], map);
    expect(result?.name).toBe('Broncos');
  });

  it('returns null when no flagged player has a map entry', () => {
    expect(resolveFlaggedTeamDisplay(game(), [jonathanTaylor], new Map())).toBeNull();
  });

  it('returns null when the mapped team matches neither side of this game', () => {
    const map: PlayerTeamMap = new Map([
      ['p-1', { teamId: 't-9', abbreviation: 'KC', name: 'Chiefs' }],
    ]);
    expect(resolveFlaggedTeamDisplay(game(), [jonathanTaylor], map)).toBeNull();
  });
});

describe('reasonChipCopy / reasonChipParts', () => {
  const colts = { name: 'Colts', abbreviation: 'IND', primaryColor: '#000', secondaryColor: '#fff' };

  it('splits a single flagged player into players + team nickname', () => {
    expect(reasonChipParts('offense_active', [jonathanTaylor], colts)).toEqual({
      players: 'Jonathan Taylor active — RB',
      team: 'Colts',
    });
    expect(reasonChipCopy('offense_active', [jonathanTaylor], colts)).toBe(
      'Jonathan Taylor active — RB — Colts',
    );
  });

  it('omits the team segment when the team could not be resolved', () => {
    expect(reasonChipParts('offense_active', [jonathanTaylor], null)).toEqual({
      players: 'Jonathan Taylor active — RB',
      team: null,
    });
    expect(reasonChipCopy('offense_active', [jonathanTaylor], null)).toBe(
      'Jonathan Taylor active — RB',
    );
  });

  it('collapses multiple flagged players into a "+N more" count without a position', () => {
    const second: FlaggedPlayer = {
      player_id: 'p-2',
      first_name: 'Michael',
      last_name: 'Pittman',
      position: 'WR',
    };
    expect(reasonChipParts('offense_active', [jonathanTaylor, second], colts)).toEqual({
      players: 'Jonathan Taylor +1 more active',
      team: 'Colts',
    });
    expect(reasonChipCopy('offense_active', [jonathanTaylor, second], colts)).toBe(
      'Jonathan Taylor +1 more active — Colts',
    );
  });

  it('uses the team nickname on the right regardless of reason type', () => {
    for (const reason of [
      'offense_active',
      'defense_active',
      'red_zone',
      'close_game',
      'star_player_active',
    ]) {
      expect(reasonChipParts(reason, [jonathanTaylor], colts).team).toBe('Colts');
    }
  });

  it('falls back to the bare reason type when there are no flagged players', () => {
    expect(reasonChipParts('offense_active', [], colts)).toEqual({
      players: 'offense_active',
      team: null,
    });
    expect(reasonChipCopy('offense_active', [], colts)).toBe('offense_active');
  });
});
