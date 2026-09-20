import { describe, expect, it } from 'vitest';
import {
  filterLiveStakeGames,
  findNextStakeGames,
  formatCountdown,
  formatDateOnlyLabel,
  formatPlayersActiveInGame,
  isLiveDisplayPhase,
  isPregameWindow,
  listStakePlayersInGame,
  resolveHomeBranch,
  seasonIdleCopy,
  upcomingStakeGameGroups,
} from './homeState';
import type { LineupResponse, LineupSlot } from './leagues';
import type { LiveGame, ScheduleGame } from './schedule';

const NOW = new Date('2026-09-13T14:00:00-04:00'); // Sunday afternoon ET-ish

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

describe('resolveHomeBranch', () => {
  it('isLiveDisplayPhase matches the live-machine gate used by WebSocket connect', () => {
    expect(isLiveDisplayPhase('off')).toBe(false);
    expect(isLiveDisplayPhase('pre')).toBe(false);
    expect(isLiveDisplayPhase('regular')).toBe(true);
    expect(isLiveDisplayPhase('post')).toBe(true);
  });

  it('State 5: no leagues wins regardless of display_phase', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: false,
        displayPhase: 'regular',
        hasFlags: true,
        hasLiveStakeGames: true,
        nextStakeKickoff: hoursFromNow(2),
        now: NOW,
      }),
    ).toEqual({ branch: 'no_leagues' });
  });

  it('off → season_idle variant off (State 4a offseason)', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'off',
        hasFlags: false,
        hasLiveStakeGames: false,
        nextStakeKickoff: null,
        now: NOW,
      }),
    ).toEqual({ branch: 'season_idle', variant: 'off' });
  });

  it('pre → season_idle variant pre (State 4a preseason) — distinct from off', () => {
    const result = resolveHomeBranch({
      hasLeagues: true,
      displayPhase: 'pre',
      hasFlags: false,
      hasLiveStakeGames: true, // even with "live" noise, pre stays idle in v1
      nextStakeKickoff: hoursFromNow(1),
      now: NOW,
    });
    expect(result).toEqual({ branch: 'season_idle', variant: 'pre' });
    expect(result).not.toEqual({ branch: 'season_idle', variant: 'off' });
  });

  it('regular + flags → State 1', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'regular',
        hasFlags: true,
        hasLiveStakeGames: true,
        nextStakeKickoff: hoursFromNow(2),
        now: NOW,
      }),
    ).toEqual({ branch: 'state1' });
  });

  it('post + flags → State 1', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'post',
        hasFlags: true,
        hasLiveStakeGames: false,
        nextStakeKickoff: null,
        now: NOW,
      }),
    ).toEqual({ branch: 'state1' });
  });

  it('regular + live stake games, no flags → State 2', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'regular',
        hasFlags: false,
        hasLiveStakeGames: true,
        nextStakeKickoff: hoursFromNow(2),
        now: NOW,
      }),
    ).toEqual({ branch: 'state2' });
  });

  it('regular + pregame window, no live flags → State 3', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'regular',
        hasFlags: false,
        hasLiveStakeGames: false,
        nextStakeKickoff: hoursFromNow(2),
        now: NOW,
      }),
    ).toEqual({ branch: 'state3' });
  });

  it('regular + off-day (kickoff beyond pregame window) → State 4', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'regular',
        hasFlags: false,
        hasLiveStakeGames: false,
        nextStakeKickoff: hoursFromNow(48),
        now: NOW,
      }),
    ).toEqual({ branch: 'state4' });
  });

  it('regular + no upcoming kickoff → State 4', () => {
    expect(
      resolveHomeBranch({
        hasLeagues: true,
        displayPhase: 'regular',
        hasFlags: false,
        hasLiveStakeGames: false,
        nextStakeKickoff: null,
        now: NOW,
      }),
    ).toEqual({ branch: 'state4' });
  });
});

describe('seasonIdleCopy — off vs pre distinct (schedule openers)', () => {
  it('offseason with preseason opener', () => {
    const copy = seasonIdleCopy('off', '2026', 2, {
      preseasonStart: '2026-08-06',
      regularSeasonStart: '2026-09-09',
    });
    expect(copy.heading).toBe('Offseason');
    expect(copy.body).toBe('Preseason begins August 6.');
    expect(copy.leagueLine).toBe('2 leagues connected');
  });

  it('offseason falls back to date-free copy when opener is null', () => {
    const copy = seasonIdleCopy('off', '2026', 1, {
      preseasonStart: null,
      regularSeasonStart: null,
    });
    expect(copy.body).toBe(
      "The season hasn't started yet. We'll start flagging your players when it does.",
    );
  });

  it('preseason with regular opener', () => {
    const copy = seasonIdleCopy('pre', '2026', 1, {
      preseasonStart: '2026-08-06',
      regularSeasonStart: '2026-09-09',
    });
    expect(copy.heading).toBe('Preseason');
    expect(copy.body).toBe('Regular season begins September 9.');
  });

  it('preseason falls back to date-free copy when opener is null', () => {
    const copy = seasonIdleCopy('pre', '2026', 1);
    expect(copy.body).toBe(
      "Preseason is underway. We'll start flagging your players once the regular season begins.",
    );
  });

  it('off and pre headings/bodies differ', () => {
    const openers = { preseasonStart: '2026-08-06' as string | null, regularSeasonStart: '2026-09-09' as string | null };
    const off = seasonIdleCopy('off', '2026', 1, openers);
    const pre = seasonIdleCopy('pre', '2026', 1, openers);
    expect(off.heading).not.toBe(pre.heading);
    expect(off.body).not.toBe(pre.body);
  });
});

describe('formatDateOnlyLabel — timezone-safe', () => {
  it('does not shift the calendar day west of UTC (unlike new Date("YYYY-MM-DD"))', () => {
    // new Date('2026-08-06') is UTC midnight → Aug 5 in US timezones.
    expect(formatDateOnlyLabel('2026-08-06')).toBe('August 6');
    expect(formatDateOnlyLabel('2026-09-09')).toBe('September 9');
  });
});

describe('isPregameWindow / formatCountdown', () => {
  it('treats same-day future kickoff as pregame', () => {
    expect(isPregameWindow(NOW, hoursFromNow(6))).toBe(true);
  });

  it('treats kickoff beyond 12h on another day as not pregame', () => {
    expect(isPregameWindow(NOW, hoursFromNow(48))).toBe(false);
  });

  it('formats countdown', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe('2h 14m');
    expect(formatCountdown(45 * 60_000)).toBe('45m');
  });
});

describe('filterLiveStakeGames', () => {
  const live: LiveGame[] = [
    {
      game_id: 'g1',
      status: 'in_progress',
      scheduled_start: '2026-09-13T17:00:00Z',
      home_team: 'KC',
      away_team: 'LV',
      home_team_name: 'Chiefs',
      away_team_name: 'Raiders',
      home_team_primary_color: '',
      home_team_secondary_color: '',
      away_team_primary_color: '',
      away_team_secondary_color: '',
      score: { home: 7, away: 0 },
      quarter: 1,
      time_remaining_sec: 800,
      possession_team: 'KC',
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    },
    {
      game_id: 'g2',
      status: 'in_progress',
      scheduled_start: '2026-09-13T17:00:00Z',
      home_team: 'BUF',
      away_team: 'MIA',
      home_team_name: 'Bills',
      away_team_name: 'Dolphins',
      home_team_primary_color: '',
      home_team_secondary_color: '',
      away_team_primary_color: '',
      away_team_secondary_color: '',
      score: { home: 3, away: 3 },
      quarter: 2,
      time_remaining_sec: 400,
      possession_team: null,
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    },
  ];

  it('keeps only games matching stake team abbreviations', () => {
    expect(filterLiveStakeGames(live, new Set(['KC'])).map((g) => g.game_id)).toEqual(['g1']);
  });
});

describe('findNextStakeGames / formatPlayersActiveInGame', () => {
  const kickoff1pm = '2026-09-14T17:00:00.000Z';
  const kickoff4pm = '2026-09-14T20:00:00.000Z';

  function scheduleGame(
    gameId: string,
    away: string,
    home: string,
    start: string,
  ): ScheduleGame {
    return {
      game_id: gameId,
      status: 'scheduled',
      scheduled_start: start,
      home_team: home,
      away_team: away,
      home_team_name: home,
      away_team_name: away,
      home_team_primary_color: '',
      home_team_secondary_color: '',
      away_team_primary_color: '',
      away_team_secondary_color: '',
      broadcasts: [],
    };
  }

  function slotPlayer(
    playerId: string,
    first: string,
    last: string,
    position: string,
    team: string,
    slotType: LineupSlot['slot_type'] = 'starter',
  ): LineupSlot {
    return {
      slot_id: playerId,
      slot_type: slotType,
      position_in_lineup: position,
      is_star: false,
      player: {
        player_id: playerId,
        first_name: first,
        last_name: last,
        position,
        team: { teamId: team, abbreviation: team, name: team },
      },
    };
  }

  it('returns every stake game at the soonest kickoff (1pm window)', () => {
    const games = [
      scheduleGame('g-mia', 'MIA', 'NE', kickoff1pm),
      scheduleGame('g-buf', 'BUF', 'NYJ', kickoff1pm),
      scheduleGame('g-kc', 'LV', 'KC', kickoff4pm),
      scheduleGame('g-other', 'DAL', 'PHI', kickoff1pm),
    ];
    const stake = new Set(['BUF', 'MIA', 'KC']);
    const now = new Date('2026-09-14T12:00:00.000Z');

    expect(findNextStakeGames(games, stake, now).map((g) => g.game_id)).toEqual([
      'g-buf',
      'g-mia',
    ]);
  });

  it('includes 1pm-window games even when scheduled_start differs by a few minutes', () => {
    // ESPN-style variance: 1:00 PM ET vs 1:05 PM ET are different timestamps.
    const games = [
      scheduleGame('g-buf', 'BUF', 'NYJ', '2026-09-14T17:00:00.000Z'),
      scheduleGame('g-phi', 'PHI', 'KC', '2026-09-14T17:05:00.000Z'),
      scheduleGame('g-dal', 'DAL', 'NYG', '2026-09-14T17:00:00.000Z'),
      scheduleGame('g-late', 'LV', 'DEN', '2026-09-14T20:25:00.000Z'),
    ];
    const stake = new Set(['BUF', 'PHI', 'DEN']);
    const now = new Date('2026-09-14T12:00:00.000Z');

    expect(findNextStakeGames(games, stake, now).map((g) => g.game_id)).toEqual([
      'g-buf',
      'g-phi',
    ]);
  });

  it('includes in_progress games in the upcoming window (status can flip before live Redis)', () => {
    const games = [
      scheduleGame('g-buf', 'BUF', 'NYJ', '2026-09-20T17:00:00.000Z'),
      {
        ...scheduleGame('g-phi', 'PHI', 'TEN', '2026-09-20T17:00:00.000Z'),
        status: 'in_progress',
      },
      scheduleGame('g-late', 'LV', 'DEN', '2026-09-20T20:25:00.000Z'),
    ];
    const stake = new Set(['BUF', 'PHI']);
    const now = new Date('2026-09-19T23:30:00.000Z');

    expect(findNextStakeGames(games, stake, now).map((g) => g.game_id)).toEqual([
      'g-buf',
      'g-phi',
    ]);
  });

  it('upcomingStakeGameGroups lists every non-final stake game chronologically', () => {
    const games = [
      scheduleGame('g-late', 'LV', 'DEN', '2026-09-20T20:25:00.000Z'),
      scheduleGame('g-buf', 'BUF', 'NYJ', '2026-09-20T17:00:00.000Z'),
      {
        ...scheduleGame('g-done', 'MIA', 'NE', '2026-09-18T17:00:00.000Z'),
        status: 'final',
      },
      scheduleGame('g-phi', 'PHI', 'TEN', '2026-09-20T17:00:00.000Z'),
    ];
    const lineups: LineupResponse[] = [
      {
        league_id: 'l1',
        week: 2,
        last_synced_at: null,
        slots: [
          slotPlayer('p-buf', 'Josh', 'Allen', 'QB', 'BUF'),
          slotPlayer('p-phi', 'Saquon', 'Barkley', 'RB', 'PHI'),
          slotPlayer('p-den', 'Bo', 'Nix', 'QB', 'DEN'),
          slotPlayer('p-mia', 'Tyreek', 'Hill', 'WR', 'MIA'),
        ],
      },
    ];
    const stake = new Set(['BUF', 'PHI', 'DEN', 'MIA']);
    expect(
      upcomingStakeGameGroups(games, lineups, stake).map((g) => g.game.game_id),
    ).toEqual(['g-buf', 'g-phi', 'g-late']);
  });

  it('excludes bench players from Active Players / upcoming stake groups', () => {
    const games = [
      scheduleGame('g-ten', 'TEN', 'SEA', '2026-09-20T17:00:00.000Z'),
      scheduleGame('g-buf', 'BUF', 'NYJ', '2026-09-20T17:00:00.000Z'),
    ];
    const lineups: LineupResponse[] = [
      {
        league_id: 'l1',
        week: 2,
        last_synced_at: null,
        slots: [
          slotPlayer('p-buf', 'Josh', 'Allen', 'QB', 'BUF', 'starter'),
          slotPlayer('p-pollard', 'Tony', 'Pollard', 'RB', 'TEN', 'bench'),
          slotPlayer('p-flex', 'James', 'Cook', 'RB', 'BUF', 'flex'),
        ],
      },
    ];
    const stake = new Set(['BUF', 'TEN']);
    const groups = upcomingStakeGameGroups(games, lineups, stake);
    expect(groups.map((g) => g.game.game_id)).toEqual(['g-buf']);
    expect(groups[0]?.players.map((p) => p.last_name).sort()).toEqual(['Allen', 'Cook']);
    expect(listStakePlayersInGame(lineups, 'TEN', 'SEA')).toEqual([]);
  });

  it('formats Active Players copy', () => {
    expect(
      formatPlayersActiveInGame([{ first_name: 'Josh', last_name: 'Allen' }]),
    ).toBe('Active Players: Josh Allen');
    expect(
      formatPlayersActiveInGame([
        { first_name: 'Josh', last_name: 'Allen' },
        { first_name: 'James', last_name: 'Cook' },
      ]),
    ).toBe('Active Players: Josh Allen, James Cook');
    expect(
      formatPlayersActiveInGame([
        { first_name: 'Josh', last_name: 'Allen' },
        { first_name: 'James', last_name: 'Cook' },
        { first_name: 'Stefon', last_name: 'Diggs' },
      ]),
    ).toBe('Active Players: Josh Allen, James Cook, Stefon Diggs');
  });
});
