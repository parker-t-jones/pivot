import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import type { PickInput } from '../pickInput.js';
import {
  FLAG,
  buildCondition,
  mapSlipLeg,
  playerNameMatches,
  resolveTeam,
  type SlipLookups,
} from './mapSlip.js';
import {
  BARKLEY,
  BROWN_PHI,
  CHI,
  GAME,
  GAMES,
  KC,
  NY_GAME,
  NYG,
  PHI,
  PLAYERS,
  SMITH_NJIGBA,
  TEAMS,
  leg,
} from './fixtures.test-helper.js';

function lookups(overrides: Partial<SlipLookups> = {}): SlipLookups & { validated: PickInput[] } {
  const validated: PickInput[] = [];
  return {
    games: GAMES,
    teams: TEAMS,
    findPlayers: async (surname) =>
      PLAYERS.filter((p) => p.last_name.toLowerCase().includes(surname.toLowerCase())),
    validate: async (input) => {
      validated.push(input);
    },
    validated,
    ...overrides,
  };
}

const named = (name: string) => PLAYERS.find((p) => p.id === name) ?? PLAYERS[0]!;

describe('resolveTeam', () => {
  it.each([
    ['PHI', PHI],
    ['phi', PHI],
    ['Eagles', PHI],
    ['Philadelphia Eagles', PHI],
    ['PHI Eagles', PHI],
    ['Philadelphia', PHI],
    ['NY Giants', NYG],
    ['Chicago Bears', CHI],
  ])('reads %s', (text, id) => {
    expect(resolveTeam(text, TEAMS)?.id).toBe(id);
  });

  it('reads an alias abbreviation', () => {
    const teams = [{ id: 'jax', abbreviation: 'JAX', city: 'Jacksonville', name: 'Jaguars' }];
    expect(resolveTeam('JAC', teams)?.id).toBe('jax');
  });

  it.each(['New York', 'Philly', '', 'Giants Jets'])('does not guess %j', (text) => {
    expect(resolveTeam(text, TEAMS)).toBeNull();
  });

  it('returns null for no team', () => {
    expect(resolveTeam(null, TEAMS)).toBeNull();
  });
});

describe('playerNameMatches', () => {
  it('matches full names, initials, punctuation, and suffixes', () => {
    expect(playerNameMatches('Saquon Barkley', named(BARKLEY))).toBe(true);
    expect(playerNameMatches('S. Barkley', named(BARKLEY))).toBe(true);
    expect(playerNameMatches('AJ Brown', named(BROWN_PHI))).toBe(true);
    expect(playerNameMatches('J. Smith-Njigba', named(SMITH_NJIGBA))).toBe(true);
    expect(playerNameMatches('Jaxon Smith Njigba Jr.', named(SMITH_NJIGBA))).toBe(true);
  });

  it('does not match a last name alone, a wrong initial, or another first name', () => {
    expect(playerNameMatches('Barkley', named(BARKLEY))).toBe(false);
    expect(playerNameMatches('T. Barkley', named(BARKLEY))).toBe(false);
    expect(playerNameMatches('Sam Barkley', named(BARKLEY))).toBe(false);
  });
});

describe('buildCondition', () => {
  it('turns "N+" into an over half a point lower', () => {
    const built = buildCondition(
      leg({ market: 'PLAYER_STAT', stat: 'REC_YDS', line: 60, plus_style: true }),
    );
    expect(built).toEqual({
      ok: true,
      condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 59.5 },
      needs: 'player',
    });
  });

  it('keeps quarter and half lines as segments', () => {
    const built = buildCondition(leg({ market: 'SPREAD', line: -0.5, period: 'Q1' }));
    expect(built).toMatchObject({
      ok: true,
      condition: { type: 'SPREAD', line: -0.5, segment: 'Q1' },
    });
  });

  it('reads a scorer bet with no side as Yes, and an explicit No as No', () => {
    expect(buildCondition(leg({ market: 'ANYTIME_TD' }))).toMatchObject({
      condition: { type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' },
    });
    expect(buildCondition(leg({ market: 'FIRST_TD', side: 'NO' }))).toMatchObject({
      condition: { type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'NO' },
    });
  });

  it.each([
    ['an unsupported market', leg({ market: 'OTHER' }), FLAG.unsupported],
    ['a quarter moneyline', leg({ market: 'MONEYLINE', period: 'H1' }), FLAG.unsupported],
    [
      'a quarter player prop',
      leg({ market: 'PLAYER_STAT', stat: 'RUSH_YDS', side: 'OVER', line: 20.5, period: 'Q1' }),
      FLAG.unsupported,
    ],
    [
      'a player prop with no stat',
      leg({ market: 'PLAYER_STAT', side: 'OVER', line: 20.5 }),
      FLAG.unsupported,
    ],
    ['a total with no side', leg({ market: 'GAME_TOTAL', line: 44.5 }), FLAG.unclear],
    ['a total with no line', leg({ market: 'GAME_TOTAL', side: 'OVER' }), FLAG.unclear],
    ['a spread with no line', leg({ market: 'SPREAD' }), FLAG.unclear],
    [
      'an "N+" under',
      leg({ market: 'TEAM_TOTAL', side: 'UNDER', line: 20, plus_style: true }),
      FLAG.unclear,
    ],
  ])('flags %s', (_name, input, reason) => {
    expect(buildCondition(input)).toEqual({ ok: false, reason });
  });
});

describe('mapSlipLeg', () => {
  it('maps a player prop to the player, his game, and the line', async () => {
    const l = lookups();
    const mapped = await mapSlipLeg(
      leg({
        text: 'Saquon Barkley Over 84.5 Rushing Yards',
        market: 'PLAYER_STAT',
        stat: 'RUSH_YDS',
        player: 'Saquon Barkley',
        side: 'OVER',
        line: 84.5,
        odds: '-115',
      }),
      l,
    );
    expect(mapped).toEqual({
      status: 'ready',
      text: 'Saquon Barkley Over 84.5 Rushing Yards',
      pick: {
        gameId: GAME,
        playerId: BARKLEY,
        condition: { type: 'STAT_OVER', stat: 'RUSH_YDS', line: 84.5 },
      },
      game: {
        game_id: GAME,
        status: 'scheduled',
        scheduled_start: '2026-10-11T17:00:00.000Z',
        home_team_id: CHI,
        away_team_id: PHI,
        home_team: 'CHI',
        away_team: 'PHI',
        home_team_name: 'Bears',
        away_team_name: 'Eagles',
      },
      player: {
        player_id: BARKLEY,
        first_name: 'Saquon',
        last_name: 'Barkley',
        position: 'RB',
        team: { abbreviation: 'PHI' },
      },
    });
    expect(l.validated).toHaveLength(1);
  });

  it('maps a spread to the picked team with its sign', async () => {
    const mapped = await mapSlipLeg(
      leg({ market: 'SPREAD', team: 'Philadelphia Eagles', line: -3.5, matchup: ['PHI', 'CHI'] }),
      lookups(),
    );
    expect(mapped).toMatchObject({
      status: 'ready',
      pick: { gameId: GAME, teamId: PHI, condition: { type: 'SPREAD', line: -3.5 } },
      player: null,
    });
  });

  it('maps a game total from the matchup', async () => {
    const mapped = await mapSlipLeg(
      leg({ market: 'GAME_TOTAL', side: 'UNDER', line: 41.5, matchup: ['NY Giants', 'NY Jets'] }),
      lookups(),
    );
    expect(mapped).toMatchObject({
      status: 'ready',
      pick: { gameId: NY_GAME, condition: { type: 'TOTAL_UNDER', line: 41.5 } },
    });
    expect(mapped.status === 'ready' && 'teamId' in mapped.pick).toBe(false);
  });

  it('maps team and game field goal totals', async () => {
    const team = await mapSlipLeg(
      leg({ market: 'FIELD_GOALS', team: 'CHI', side: 'OVER', line: 1.5 }),
      lookups(),
    );
    expect(team).toMatchObject({ pick: { teamId: CHI, condition: { type: 'FG_OVER' } } });
    const game = await mapSlipLeg(
      leg({ market: 'FIELD_GOALS', matchup: ['PHI', 'CHI'], side: 'UNDER', line: 3.5 }),
      lookups(),
    );
    expect(game).toMatchObject({ pick: { gameId: GAME, condition: { type: 'FG_UNDER' } } });
    expect(game.status === 'ready' && game.pick.teamId).toBeFalsy();
  });

  it('uses the printed team to tell two players with one name apart', async () => {
    const both = await mapSlipLeg(leg({ market: 'ANYTIME_TD', player: 'A. Brown' }), lookups());
    expect(both).toEqual({
      status: 'flagged',
      text: 'leg',
      reason: 'More than one player matches A. Brown.',
    });
    const one = await mapSlipLeg(
      leg({ market: 'ANYTIME_TD', player: 'A. Brown', team: 'PHI' }),
      lookups(),
    );
    expect(one).toMatchObject({ status: 'ready', pick: { playerId: BROWN_PHI } });
  });

  it('flags a player not in this week’s games, and an unknown player', async () => {
    expect(
      await mapSlipLeg(leg({ market: 'ANYTIME_TD', player: 'Travis Kelce' }), lookups()),
    ).toMatchObject({
      status: 'flagged',
      reason: 'We couldn’t find Travis Kelce in this week’s games.',
    });
    expect(
      await mapSlipLeg(leg({ market: 'ANYTIME_TD', player: 'Nobody Atall' }), lookups()),
    ).toMatchObject({ status: 'flagged' });
    expect(
      await mapSlipLeg(leg({ market: 'ANYTIME_TD', player: 'Barkley' }), lookups()),
    ).toMatchObject({ status: 'flagged', reason: 'We couldn’t tell which player this is.' });
  });

  it('flags an ambiguous team instead of guessing', async () => {
    const mapped = await mapSlipLeg(leg({ market: 'MONEYLINE', team: 'New York' }), lookups());
    expect(mapped).toMatchObject({ status: 'flagged', reason: FLAG.team });
  });

  it('flags a team with no game this week', async () => {
    const mapped = await mapSlipLeg(leg({ market: 'MONEYLINE', team: 'Chiefs' }), lookups());
    expect(mapped).toMatchObject({ status: 'flagged', reason: FLAG.game });
    expect(resolveTeam('Chiefs', TEAMS)?.id).toBe(KC);
  });

  it('flags a matchup that is not the picked team’s game', async () => {
    const mapped = await mapSlipLeg(
      leg({ market: 'MONEYLINE', team: 'PHI', matchup: ['NYG', 'NYJ'] }),
      lookups(),
    );
    expect(mapped).toMatchObject({ status: 'flagged', reason: FLAG.game });
  });

  it('flags a game total whose teams are in different games', async () => {
    const mapped = await mapSlipLeg(
      leg({ market: 'GAME_TOTAL', side: 'OVER', line: 44.5, matchup: ['PHI', 'NYG'] }),
      lookups(),
    );
    expect(mapped).toMatchObject({ status: 'flagged', reason: FLAG.game });
  });

  it('flags a slip dated for another week, and accepts the game’s own date', async () => {
    const old = await mapSlipLeg(
      leg({ market: 'MONEYLINE', team: 'PHI', game_date: '2026-09-14' }),
      lookups(),
    );
    expect(old).toMatchObject({ status: 'flagged', reason: FLAG.otherWeek });
    const same = await mapSlipLeg(
      leg({ market: 'MONEYLINE', team: 'PHI', game_date: '2026-10-11' }),
      lookups(),
    );
    expect(same.status).toBe('ready');
  });

  it('flags a pick the POST /picks check would refuse, with plain copy', async () => {
    const refuse = (code: string) =>
      lookups({
        validate: async () => {
          throw new ApiError(400, code, 'internal copy');
        },
      });
    expect(
      await mapSlipLeg(
        leg({ market: 'SPREAD', team: 'PHI', line: -80 }),
        refuse('stake_line_invalid'),
      ),
    ).toMatchObject({ status: 'flagged', reason: FLAG.line });
    expect(
      await mapSlipLeg(leg({ market: 'MONEYLINE', team: 'PHI' }), refuse('stake_game_invalid')),
    ).toMatchObject({ status: 'flagged', reason: FLAG.over });
    expect(
      await mapSlipLeg(leg({ market: 'MONEYLINE', team: 'PHI' }), refuse('stake_team_invalid')),
    ).toMatchObject({ status: 'flagged', reason: FLAG.noMatch });
  });

  it('passes database errors through instead of flagging them', async () => {
    const broken = lookups({
      validate: async () => {
        throw new Error('db down');
      },
    });
    await expect(mapSlipLeg(leg({ market: 'MONEYLINE', team: 'PHI' }), broken)).rejects.toThrow(
      'db down',
    );
  });
});
