import { describe, expect, it } from 'vitest';

import { formatGameLine, gameForTeam, type PlayerWeekGame } from './playerGame';

const ET = 'America/New_York';

/** Sunday Oct 4, 2026 1:00 PM EDT. */
const SUN_1PM = '2026-10-04T17:00:00.000Z';
/** Sunday Oct 4, 2026 8:15 PM EDT. */
const SUN_815PM = '2026-10-05T00:15:00.000Z';
/** Monday Oct 5, 2026 12:15 AM EDT — just after local midnight. */
const MON_1215AM = '2026-10-05T04:15:00.000Z';

function game(overrides: Partial<PlayerWeekGame> = {}): PlayerWeekGame {
  return {
    status: 'scheduled',
    scheduled_start: SUN_1PM,
    home_team: 'NYJ',
    away_team: 'NE',
    home_team_primary_color: '#125740',
    away_team_primary_color: '#002244',
    airings: [{ network: 'fox' }],
    ...overrides,
  };
}

describe('gameForTeam', () => {
  const now = new Date('2026-10-04T16:00:00.000Z');
  const slate = [game()];

  it('matches the home team', () => {
    expect(gameForTeam(slate, 'NYJ', now)).toMatchObject({
      kind: 'scheduled',
      isHome: true,
      opponentAbbr: 'NE',
      network: 'FOX',
      teamColor: '#125740',
    });
  });

  it('matches the away team', () => {
    expect(gameForTeam(slate, 'ne', now)).toMatchObject({
      kind: 'scheduled',
      isHome: false,
      opponentAbbr: 'NYJ',
      network: 'FOX',
      teamColor: '#002244',
    });
  });

  it('is a bye when the team is not on the slate', () => {
    expect(gameForTeam(slate, 'KC', now)).toEqual({ kind: 'bye' });
  });

  it('reads live and final from game status', () => {
    expect(gameForTeam([game({ status: 'in_progress' })], 'NYJ', now).kind).toBe('live');
    expect(gameForTeam([game({ status: 'final' })], 'NYJ', now).kind).toBe('final');
  });

  it('omits the network when no airing maps to a label', () => {
    expect(gameForTeam([game({ airings: [] })], 'NYJ', now)).toMatchObject({ network: null });
  });

  it('treats a blank team color as null', () => {
    expect(
      gameForTeam([game({ home_team_primary_color: '' })], 'NYJ', now),
    ).toMatchObject({ teamColor: null });
  });
});

describe('formatGameLine', () => {
  /** Saturday afternoon ET, so Sunday's kickoff is not TODAY. */
  const slateNow = new Date('2026-10-03T16:00:00.000Z');

  it('formats a scheduled kickoff with the network', () => {
    const result = gameForTeam([game()], 'NYJ', slateNow);
    expect(formatGameLine(result, slateNow, ET)).toBe('SUN 1:00 PM · FOX');
  });

  it('drops the network when it is null', () => {
    const result = gameForTeam([game({ airings: [] })], 'NYJ', slateNow);
    expect(formatGameLine(result, slateNow, ET)).toBe('SUN 1:00 PM');
  });

  it('formats live, final, and bye', () => {
    const live = gameForTeam([game({ status: 'in_progress' })], 'NYJ', slateNow);
    const final = gameForTeam([game({ status: 'final' })], 'NYJ', slateNow);
    expect(formatGameLine(live, slateNow, ET)).toBe('LIVE');
    expect(formatGameLine(final, slateNow, ET)).toBe('FINAL');
    expect(formatGameLine({ kind: 'bye' }, slateNow, ET)).toBe('BYE');
  });

  it('uses TODAY only on the same local calendar day, across midnight in America/New_York', () => {
    const sundayNight = new Date('2026-10-05T03:30:00.000Z');
    const sundayGame = gameForTeam(
      [game({ scheduled_start: SUN_815PM, airings: [{ network: 'amazon_prime' }] })],
      'NYJ',
      sundayNight,
    );
    const mondayGame = gameForTeam(
      [game({ scheduled_start: MON_1215AM, airings: [{ network: 'espn' }] })],
      'NYJ',
      sundayNight,
    );
    expect(formatGameLine(sundayGame, sundayNight, ET)).toBe('TODAY 8:15 PM · PRIME');
    expect(formatGameLine(mondayGame, sundayNight, ET)).toBe('MON 12:15 AM · ESPN');

    const mondayMorning = new Date('2026-10-05T04:30:00.000Z');
    expect(formatGameLine(sundayGame, mondayMorning, ET)).toBe('SUN 8:15 PM · PRIME');
    expect(formatGameLine(mondayGame, mondayMorning, ET)).toBe('TODAY 12:15 AM · ESPN');
  });
});
