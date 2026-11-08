import { describe, expect, it } from 'vitest';
import { isDecided, neededForOver, overUnder, pickProgress, roomUnder } from './pickProgress.js';
import {
  AWAY,
  ESPN_ID,
  HOME,
  TEAM_ATL,
  TEAM_GB,
  WHOLE_GAME,
  ctx,
  game,
  line,
  player,
  stake,
  stats,
} from './testFixtures.js';

describe('needed and room', () => {
  it('counts whole units to clear an over: 89.5 at 78 is 12, 90 at 78 is 13', () => {
    expect(neededForOver(78, 89.5)).toBe(12);
    expect(neededForOver(78, 90)).toBe(13);
    expect(neededForOver(95, 89.5)).toBe(0);
  });

  it('counts room under an under before it loses or ties', () => {
    expect(roomUnder(78, 89.5)).toBe(11);
    expect(roomUnder(78, 90)).toBe(11);
    expect(roomUnder(95, 89.5)).toBe(0);
  });
});

describe('overUnder', () => {
  it('is hit as soon as an over clears during play, and live one short of it', () => {
    expect(overUnder('OVER', 90, 89.5, false).status).toBe('hit');
    expect(overUnder('OVER', 89, 89.5, false)).toEqual({
      status: 'live',
      current: 89,
      line: 89.5,
      needed: 1,
    });
  });

  it('is missed as soon as an under goes over during play', () => {
    expect(overUnder('UNDER', 90, 89.5, false).status).toBe('missed');
    expect(overUnder('UNDER', 89, 89.5, false).status).toBe('live');
  });

  it('settles won, lost, and tie on an integer line once decided', () => {
    expect(overUnder('OVER', 91, 90, true).status).toBe('won');
    expect(overUnder('OVER', 90, 90, true).status).toBe('tie');
    expect(overUnder('UNDER', 90, 90, true).status).toBe('tie');
    expect(overUnder('UNDER', 89, 90, true).status).toBe('won');
    expect(overUnder('OVER', 89, 90, true).status).toBe('lost');
  });
});

describe('pickProgress: player props', () => {
  const rushOver = stake({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 89.5 });

  it('is pending before kickoff', () => {
    expect(pickProgress(rushOver, ctx({ game: game({ status: 'scheduled' }) })).status).toBe(
      'pending',
    );
  });

  it('reads the matched player by ESPN id and reports yards to go', () => {
    const c = ctx({ playerStats: stats({ players: { [ESPN_ID]: line({ RUSH_YDS: 78 }) } }) });
    expect(pickProgress(rushOver, c)).toEqual({
      status: 'live',
      current: 78,
      line: 89.5,
      needed: 12,
    });
  });

  it('goes back to live when a stat correction drops a hit under the line', () => {
    const hit = ctx({ playerStats: stats({ players: { [ESPN_ID]: line({ RUSH_YDS: 92 }) } }) });
    const corrected = ctx({
      playerStats: stats({ players: { [ESPN_ID]: line({ RUSH_YDS: 88 }) } }),
    });
    expect(pickProgress(rushOver, hit).status).toBe('hit');
    expect(pickProgress(rushOver, corrected).status).toBe('live');
  });

  it('treats a player not in the boxscore yet as 0 during play', () => {
    expect(pickProgress(rushOver, ctx())).toMatchObject({ status: 'live', current: 0, needed: 90 });
  });

  it('voids a player with an ESPN id who is not in the final boxscore', () => {
    expect(
      pickProgress(
        rushOver,
        ctx({ game: game({ status: 'final' }), playerStats: stats({ final: true }) }),
      ).status,
    ).toBe('void');
  });

  it('settles on the final boxscore', () => {
    const final = ctx({
      game: game({ status: 'final' }),
      playerStats: stats({ final: true, players: { [ESPN_ID]: line({ RUSH_YDS: 194 }) } }),
    });
    expect(pickProgress(rushOver, final).status).toBe('won');
    expect(
      pickProgress(stake({ type: 'STAT_UNDER', stat: 'RUSH_YDS', line: 89.5 }), final).status,
    ).toBe('lost');
  });

  it('falls back to the name on the right team when the player has no ESPN id', () => {
    const c = ctx({
      player: player({ espnId: null }),
      playerStats: stats({
        players: {
          other: line({ RUSH_YDS: 5 }, { teamId: HOME }),
          x: line({ RUSH_YDS: 40 }, { displayName: 'Bijan Robinson' }),
        },
      }),
    });
    expect(pickProgress(rushOver, c)).toMatchObject({ status: 'live', current: 40 });
  });

  it('is unavailable with no ESPN id and no name match, and never voids', () => {
    const c = ctx({
      player: player({ espnId: null }),
      game: game({ status: 'final' }),
      playerStats: stats({ final: true }),
    });
    expect(pickProgress(rushOver, c).status).toBe('unavailable');
  });

  it('is unavailable when the runner resolved a different player', () => {
    expect(
      pickProgress(rushOver, ctx({ player: player({ playerId: 'someone-else' }) })).status,
    ).toBe('unavailable');
  });

  it('decides anytime TD YES on the first TD and NO at final with none', () => {
    const yes = stake({ type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'YES' });
    const no = stake({ type: 'PLAYER_EVENT', event: 'ANY_TD', side: 'NO' });
    const scored = ctx({ playerStats: stats({ players: { [ESPN_ID]: line({ ANY_TD: 1 }) } }) });
    expect(pickProgress(yes, scored).status).toBe('hit');
    expect(pickProgress(no, scored).status).toBe('missed');
    const final = ctx({
      game: game({ status: 'final' }),
      playerStats: stats({ final: true, players: { [ESPN_ID]: line({ ANY_TD: 0, RUSH_YDS: 3 }) } }),
    });
    expect(pickProgress(yes, final).status).toBe('lost');
    expect(pickProgress(no, final).status).toBe('won');
  });
});

describe('pickProgress: first TD', () => {
  const yes = stake({ type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'YES' });
  const no = stake({ type: 'PLAYER_EVENT', event: 'FIRST_TD', side: 'NO' });
  const players = {
    [ESPN_ID]: line({ ANY_TD: 1 }),
    watson: line({ ANY_TD: 1 }, { teamId: HOME, displayName: 'Christian Watson' }),
  };

  it('is live before any TD', () => {
    expect(pickProgress(yes, ctx({ playerStats: stats({ players }) })).status).toBe('live');
  });

  it('is hit when the first TD text names the player, and missed for NO', () => {
    const c = ctx({
      playerStats: stats({
        players,
        scoringPlays: [
          { teamId: AWAY, period: 1, kind: 'FG', text: 'Nick Folk 44 Yd Field Goal' },
          {
            teamId: AWAY,
            period: 1,
            kind: 'TD',
            text: 'Bijan Robinson 3 Yd Rush (Nick Folk Kick)',
          },
        ],
      }),
    });
    expect(pickProgress(yes, c).status).toBe('hit');
    expect(pickProgress(no, c).status).toBe('missed');
  });

  it('is missed when someone else scores first', () => {
    const c = ctx({
      playerStats: stats({
        players,
        scoringPlays: [
          {
            teamId: HOME,
            period: 1,
            kind: 'TD',
            text: 'Christian Watson 4 Yd pass from Jordan Love',
          },
        ],
      }),
    });
    expect(pickProgress(yes, c).status).toBe('missed');
    expect(pickProgress(no, c).status).toBe('hit');
  });

  it('settles YES lost and NO won when nobody scores a TD', () => {
    const c = ctx({
      game: game({ status: 'final' }),
      playerStats: stats({
        final: true,
        players: { [ESPN_ID]: line({ RUSH_YDS: 10, ANY_TD: 0 }) },
      }),
    });
    expect(pickProgress(yes, c).status).toBe('lost');
    expect(pickProgress(no, c).status).toBe('won');
  });

  it('is unavailable when the TD text names nobody on the scoring team', () => {
    const c = ctx({
      playerStats: stats({
        players,
        scoringPlays: [{ teamId: AWAY, period: 1, kind: 'TD', text: 'Somebody Else 1 Yd Rush' }],
      }),
    });
    expect(pickProgress(yes, c).status).toBe('unavailable');
  });

  it('voids a player who did not play, even after a first TD', () => {
    const c = ctx({
      game: game({ status: 'final' }),
      playerStats: stats({
        final: true,
        players: { watson: players.watson },
        scoringPlays: [{ teamId: HOME, period: 1, kind: 'TD', text: 'Christian Watson 4 Yd pass' }],
      }),
    });
    expect(pickProgress(yes, c).status).toBe('void');
  });
});

describe('pickProgress: team and game props', () => {
  it('reads a quarter team total from linescores and decides it once Q1 is over', () => {
    const q1 = stake({ type: 'TEAM_TOTAL_OVER', line: 6.5, segment: 'Q1' }, TEAM_ATL);
    const during = ctx({
      game: game({ quarter: 1 }),
      playerStats: stats({ linescores: { home: [0], away: [3] } }),
    });
    expect(pickProgress(q1, during)).toMatchObject({ status: 'live', current: 3, needed: 4 });
    const after = ctx({
      game: game({ quarter: 2 }),
      playerStats: stats({ linescores: { home: [7], away: [7, 0] } }),
    });
    expect(pickProgress(q1, after).status).toBe('won');
  });

  it('is pending for a Q3 pick while the game is still in Q2', () => {
    const q3 = stake({ type: 'TOTAL_OVER', line: 10.5, segment: 'Q3' }, WHOLE_GAME);
    expect(pickProgress(q3, ctx({ game: game({ quarter: 2 }) })).status).toBe('pending');
  });

  it('counts OT in H2 but not in Q4', () => {
    const linescores = { home: [7, 0, 0, 7, 6], away: [7, 10, 7, 0, 0] };
    const c = ctx({
      game: game({ status: 'final', quarter: 5 }),
      playerStats: stats({ final: true, linescores }),
    });
    expect(
      pickProgress(stake({ type: 'TEAM_TOTAL_OVER', line: 12.5, segment: 'H2' }, TEAM_GB), c),
    ).toMatchObject({ status: 'won', current: 13 });
    expect(
      pickProgress(stake({ type: 'TEAM_TOTAL_OVER', line: 6.5, segment: 'Q4' }, TEAM_GB), c),
    ).toMatchObject({ status: 'won', current: 7 });
    expect(
      pickProgress(stake({ type: 'TEAM_TOTAL_UNDER', line: 7.5, segment: 'Q4' }, TEAM_GB), c),
    ).toMatchObject({ status: 'won', current: 7 });
  });

  it('settles a first-half spread at halftime, including a tie', () => {
    const h1 = (line: number) => stake({ type: 'SPREAD', line, segment: 'H1' }, TEAM_GB);
    const c = ctx({
      game: game({ quarter: 3 }),
      playerStats: stats({ linescores: { home: [7, 0, 0], away: [7, 10, 0] } }),
    });
    expect(pickProgress(h1(10), c).status).toBe('tie');
    expect(pickProgress(h1(10.5), c).status).toBe('won');
    expect(pickProgress(h1(3.5), c).status).toBe('lost');
  });

  it('keeps the existing full-game moneyline, spread, and total on the live score', () => {
    const c = ctx({ game: game({ quarter: 4, scoreHome: 14, scoreAway: 35 }) });
    expect(pickProgress(stake({ type: 'MONEYLINE', side: 'TEAM' }, TEAM_ATL), c)).toEqual({
      status: 'live',
      current: 21,
    });
    expect(pickProgress(stake({ type: 'TOTAL_UNDER', line: 48.5 }, WHOLE_GAME), c).status).toBe(
      'missed',
    );
    const final = ctx({ game: game({ status: 'final', scoreHome: 14, scoreAway: 35 }) });
    expect(pickProgress(stake({ type: 'SPREAD', line: 20.5 }, TEAM_GB), final).status).toBe('lost');
    expect(pickProgress(stake({ type: 'SPREAD', line: -21 }, TEAM_ATL), final).status).toBe('tie');
  });

  it('counts field goals per team and per game', () => {
    const scoringPlays = [
      { teamId: AWAY, period: 2, kind: 'FG' as const, text: '' },
      { teamId: AWAY, period: 4, kind: 'FG' as const, text: '' },
      { teamId: HOME, period: 4, kind: 'TD' as const, text: '' },
    ];
    const c = ctx({
      game: game({ status: 'final' }),
      playerStats: stats({ final: true, scoringPlays }),
    });
    expect(pickProgress(stake({ type: 'FG_OVER', line: 1.5 }, TEAM_ATL), c).status).toBe('won');
    expect(pickProgress(stake({ type: 'FG_UNDER', line: 0.5 }, TEAM_GB), c).status).toBe('won');
    expect(pickProgress(stake({ type: 'FG_OVER', line: 2.5 }, WHOLE_GAME), c).status).toBe('lost');
    expect(
      pickProgress(stake({ type: 'FG_OVER', line: 0.5, segment: 'H1' }, WHOLE_GAME), c).status,
    ).toBe('won');
  });

  it('decides first team to score on the first scoring play, and voids a scoreless game', () => {
    const atl = stake({ type: 'FIRST_TO_SCORE' }, TEAM_ATL);
    const gb = stake({ type: 'FIRST_TO_SCORE' }, TEAM_GB);
    const c = ctx({
      playerStats: stats({ scoringPlays: [{ teamId: HOME, period: 1, kind: 'TD', text: '' }] }),
    });
    expect(pickProgress(gb, c).status).toBe('hit');
    expect(pickProgress(atl, c).status).toBe('missed');
    expect(pickProgress(atl, ctx()).status).toBe('live');
    expect(
      pickProgress(
        atl,
        ctx({ game: game({ status: 'final' }), playerStats: stats({ final: true }) }),
      ).status,
    ).toBe('void');
  });

  it('is unavailable for a team that is not in the game', () => {
    expect(
      pickProgress(
        stake({ type: 'TEAM_TOTAL_OVER', line: 20.5 }, { type: 'TEAM', teamId: 'DAL' }),
        ctx(),
      ).status,
    ).toBe('unavailable');
  });
});

describe('isDecided', () => {
  it('treats only live and pending as open', () => {
    expect(isDecided({ status: 'live' })).toBe(false);
    expect(isDecided({ status: 'pending' })).toBe(false);
    for (const status of ['hit', 'missed', 'won', 'lost', 'tie', 'void', 'unavailable'] as const) {
      expect(isDecided({ status })).toBe(true);
    }
  });
});
