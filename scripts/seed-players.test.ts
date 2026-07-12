import { describe, expect, it } from 'vitest';
import {
  buildDefensePlayerRows,
  isEligibleSleeperPlayer,
  resolveTeamAbbreviation,
  toPlayerRow,
  type SleeperPlayer,
} from './seed-players.js';

function makePlayer(overrides: Partial<SleeperPlayer> = {}): SleeperPlayer {
  return {
    player_id: '4046',
    first_name: 'Patrick',
    last_name: 'Mahomes',
    position: 'QB',
    team: 'KC',
    active: true,
    number: 15,
    ...overrides,
  };
}

describe('resolveTeamAbbreviation', () => {
  it('maps LA to LAR', () => {
    expect(resolveTeamAbbreviation('LA')).toBe('LAR');
  });

  it('maps WAS and WSH to WAS', () => {
    expect(resolveTeamAbbreviation('WAS')).toBe('WAS');
    expect(resolveTeamAbbreviation('WSH')).toBe('WAS');
  });

  it('maps JAX and JAC to JAX', () => {
    expect(resolveTeamAbbreviation('JAX')).toBe('JAX');
    expect(resolveTeamAbbreviation('JAC')).toBe('JAX');
  });

  it('drops defunct codes', () => {
    expect(resolveTeamAbbreviation('OAK')).toBeNull();
    expect(resolveTeamAbbreviation('SD')).toBeNull();
    expect(resolveTeamAbbreviation('STL')).toBeNull();
  });

  it('passes through unmapped codes unchanged', () => {
    expect(resolveTeamAbbreviation('KC')).toBe('KC');
    expect(resolveTeamAbbreviation('IND')).toBe('IND');
  });
});

describe('isEligibleSleeperPlayer', () => {
  it('accepts an active fantasy-relevant player with a team', () => {
    expect(isEligibleSleeperPlayer(makePlayer())).toBe(true);
  });

  it('rejects inactive players', () => {
    expect(isEligibleSleeperPlayer(makePlayer({ active: false }))).toBe(false);
  });

  it('rejects free agents (no team)', () => {
    expect(isEligibleSleeperPlayer(makePlayer({ team: null }))).toBe(false);
  });

  it('rejects IDP and other out-of-scope positions', () => {
    for (const position of ['LB', 'DB', 'DL', 'OL', 'P', 'LS']) {
      expect(isEligibleSleeperPlayer(makePlayer({ position }))).toBe(false);
    }
  });

  it('rejects DEF entries from the dump (synthesized separately)', () => {
    expect(isEligibleSleeperPlayer(makePlayer({ position: 'DEF', team: 'KC' }))).toBe(false);
  });

  it('rejects players with a null position', () => {
    expect(isEligibleSleeperPlayer(makePlayer({ position: null }))).toBe(false);
  });
});

describe('toPlayerRow', () => {
  const teamIdByAbbreviation = new Map([
    ['KC', 'team-kc-uuid'],
    ['LAR', 'team-lar-uuid'],
  ]);

  it('builds a row for an eligible player on a directly-mapped team', () => {
    const row = toPlayerRow(makePlayer(), teamIdByAbbreviation);
    expect(row).toEqual({
      sleeper_id: '4046',
      first_name: 'Patrick',
      last_name: 'Mahomes',
      position: 'QB',
      team_id: 'team-kc-uuid',
      active: true,
      jersey_number: 15,
    });
  });

  it('resolves through the team abbreviation override map', () => {
    const row = toPlayerRow(makePlayer({ team: 'LA' }), teamIdByAbbreviation);
    expect(row?.team_id).toBe('team-lar-uuid');
  });

  it('returns null for a defunct team code', () => {
    expect(toPlayerRow(makePlayer({ team: 'OAK' }), teamIdByAbbreviation)).toBeNull();
  });

  it('returns null when the resolved team is not in the lookup map', () => {
    expect(toPlayerRow(makePlayer({ team: 'BUF' }), teamIdByAbbreviation)).toBeNull();
  });

  it('defaults missing names to empty strings and missing jersey number to null', () => {
    const row = toPlayerRow(
      makePlayer({ first_name: null, last_name: null, number: null }),
      teamIdByAbbreviation,
    );
    expect(row).toMatchObject({ first_name: '', last_name: '', jersey_number: null });
  });
});

describe('buildDefensePlayerRows', () => {
  it('synthesizes one DEF row per team using the team abbreviation as sleeper_id', () => {
    const teams = [
      { id: 'team-ind-uuid', abbreviation: 'IND' },
      { id: 'team-kc-uuid', abbreviation: 'KC' },
    ];
    expect(buildDefensePlayerRows(teams)).toEqual([
      {
        sleeper_id: 'IND',
        first_name: '',
        last_name: 'Defense',
        position: 'DEF',
        team_id: 'team-ind-uuid',
        active: true,
        jersey_number: null,
      },
      {
        sleeper_id: 'KC',
        first_name: '',
        last_name: 'Defense',
        position: 'DEF',
        team_id: 'team-kc-uuid',
        active: true,
        jersey_number: null,
      },
    ]);
  });
});
