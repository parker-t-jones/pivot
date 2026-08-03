import { describe, expect, it } from 'vitest';
import {
  filterLiveStakeGames,
  formatCountdown,
  formatDateOnlyLabel,
  isLiveDisplayPhase,
  isPregameWindow,
  resolveHomeBranch,
  seasonIdleCopy,
} from './homeState';
import type { LiveGame } from './schedule';

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
    },
  ];

  it('keeps only games matching stake team abbreviations', () => {
    expect(filterLiveStakeGames(live, new Set(['KC'])).map((g) => g.game_id)).toEqual(['g1']);
  });
});
