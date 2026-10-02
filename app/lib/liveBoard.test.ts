import { describe, expect, it } from 'vitest';
import type { StakeRef } from './board';
import { buildLiveBoard, countLiveGames, type LiveBoardSection } from './liveBoard';
import type { LiveGame, ScheduleGame } from './schedule';

function game(
  gameId: string,
  scheduledStart: string,
  status: ScheduleGame['status'] = 'scheduled',
  teams: { home: string; away: string } = { home: 'KC', away: 'BUF' },
): ScheduleGame {
  return {
    game_id: gameId,
    status,
    scheduled_start: scheduledStart,
    home_team: teams.home,
    away_team: teams.away,
    home_team_name: teams.home,
    away_team_name: teams.away,
    home_team_primary_color: '#111111',
    home_team_secondary_color: '#222222',
    away_team_primary_color: '#333333',
    away_team_secondary_color: '#444444',
    broadcasts: [],
    airings: [],
  };
}

function live(source: ScheduleGame): LiveGame {
  return {
    game_id: source.game_id,
    status: 'in_progress',
    scheduled_start: source.scheduled_start,
    home_team: source.home_team,
    away_team: source.away_team,
    home_team_name: source.home_team_name,
    away_team_name: source.away_team_name,
    home_team_primary_color: source.home_team_primary_color,
    home_team_secondary_color: source.home_team_secondary_color,
    away_team_primary_color: source.away_team_primary_color,
    away_team_secondary_color: source.away_team_secondary_color,
    score: { home: 7, away: 3 },
    quarter: 2,
    time_remaining_sec: 300,
    possession_team: source.home_team,
    yards_to_endzone: 40,
    down: 1,
    distance: 10,
    in_red_zone: false,
  };
}

/** Sunday 2026-10-04 slots, in ET: 1:00pm, 1:00pm, 4:25pm, 8:20pm; plus Thursday and Monday. */
const THU = '2026-10-02T00:15:00Z';
const EARLY = '2026-10-04T17:00:00Z';
const LATE = '2026-10-04T20:25:00Z';
const SNF = '2026-10-05T00:20:00Z';
const MNF = '2026-10-06T00:15:00Z';

function ids(section: LiveBoardSection | undefined): string[] {
  if (!section) return [];
  return section.kind === 'up_next'
    ? section.groups.flatMap((group) => group.rows.map((row) => row.gameId))
    : section.rows.map((row) => row.gameId);
}

function sectionOf(sections: LiveBoardSection[], kind: LiveBoardSection['kind']) {
  return sections.find((section) => section.kind === kind);
}

function board(
  weekGames: ScheduleGame[],
  overrides: Partial<Parameters<typeof buildLiveBoard>[0]> = {},
): LiveBoardSection[] {
  return buildLiveBoard({
    weekGames,
    liveGames: [],
    flaggedGameIds: [],
    heroGameIds: [],
    stakeRefs: [],
    ...overrides,
  });
}

describe('buildLiveBoard', () => {
  it('orders sections LIVE, UP NEXT, FINAL', () => {
    const sections = board([
      game('up', SNF),
      game('done', THU, 'final'),
      game('now', EARLY, 'in_progress'),
    ]);
    expect(sections.map((section) => section.kind)).toEqual(['live', 'up_next', 'final']);
  });

  it('leaves out the hero game and the Also Flagged games', () => {
    const weekGames = [
      game('hero', EARLY, 'in_progress'),
      game('tile', EARLY, 'in_progress'),
      game('other', LATE, 'in_progress'),
    ];
    const sections = board(weekGames, { heroGameIds: ['hero'], flaggedGameIds: ['tile'] });
    expect(ids(sectionOf(sections, 'live'))).toEqual(['other']);
  });

  it('never shows a game twice', () => {
    const b = game('b', EARLY, 'in_progress');
    const c = game('c', EARLY, 'in_progress');
    const weekGames = [
      game('a', THU, 'final'),
      b,
      c,
      game('d', LATE),
      game('e', SNF),
      game('f', MNF),
    ];
    const hero = ['b'];
    const flagged = ['c'];
    const sections = board(weekGames, {
      liveGames: [live(b), live(c)],
      heroGameIds: hero,
      flaggedGameIds: flagged,
    });
    const shownOnBoard = sections.flatMap(ids);
    expect(new Set(shownOnBoard).size).toBe(shownOnBoard.length);
    for (const id of [...hero, ...flagged]) expect(shownOnBoard).not.toContain(id);
    expect(shownOnBoard.sort()).toEqual(['a', 'd', 'e', 'f']);
  });

  it('puts stake games first in LIVE, then sorts by kickoff', () => {
    const weekGames = [
      game('late-stake', LATE, 'in_progress', { home: 'PHI', away: 'CHI' }),
      game('early-none', EARLY, 'in_progress', { home: 'NYG', away: 'DAL' }),
      game('early-stake', EARLY, 'in_progress', { home: 'CLE', away: 'PIT' }),
      game('late-none', LATE, 'in_progress', { home: 'SEA', away: 'LAR' }),
    ];
    const stakeRefs: StakeRef[] = [
      { gameId: 'late-stake', teamId: 'PHI' },
      { gameId: 'early-stake', teamId: 'CLE' },
    ];
    const sections = board(weekGames, { stakeRefs });
    expect(ids(sectionOf(sections, 'live'))).toEqual([
      'early-stake',
      'late-stake',
      'early-none',
      'late-none',
    ]);
  });

  it('groups UP NEXT by broadcast window in kickoff order', () => {
    const sections = board([game('mnf', MNF), game('late', LATE), game('early', EARLY)]);
    const upNext = sectionOf(sections, 'up_next');
    expect(upNext?.kind).toBe('up_next');
    if (upNext?.kind !== 'up_next') return;
    expect(upNext.groups.map((group) => group.label)).toEqual([
      'SUNDAY · EARLY',
      'SUNDAY · LATE',
      'MONDAY',
    ]);
  });

  it('lists FINAL most recent kickoff first', () => {
    const sections = board([
      game('thu', THU, 'final'),
      game('early', EARLY, 'final'),
      game('late', LATE, 'final'),
    ]);
    expect(ids(sectionOf(sections, 'final'))).toEqual(['late', 'early', 'thu']);
  });

  it('omits empty sections', () => {
    expect(board([]).length).toBe(0);
    expect(board([game('a', EARLY)]).map((section) => section.kind)).toEqual(['up_next']);
    expect(board([game('a', EARLY, 'final')]).map((section) => section.kind)).toEqual(['final']);
    expect(
      board([game('a', EARLY, 'in_progress')], { heroGameIds: ['a'] }).map((s) => s.kind),
    ).toEqual([]);
  });

  it('moves a game from LIVE to FINAL when it ends', () => {
    const before = game('g', EARLY, 'in_progress');
    const during = board([before, game('x', SNF)], { liveGames: [live(before)] });
    expect(ids(sectionOf(during, 'live'))).toEqual(['g']);
    expect(ids(sectionOf(during, 'final'))).toEqual([]);

    const after = board([game('g', EARLY, 'final'), game('x', SNF)], { liveGames: [] });
    expect(ids(sectionOf(after, 'live'))).toEqual([]);
    expect(ids(sectionOf(after, 'final'))).toEqual(['g']);
  });

  it('gives LIVE rows the clock and score from the live list', () => {
    const withState = game('a', EARLY, 'in_progress');
    const noState = game('b', LATE, 'in_progress');
    const sections = board([withState, noState], { liveGames: [live(withState)] });
    const liveSection = sectionOf(sections, 'live');
    if (liveSection?.kind !== 'live') throw new Error('expected a LIVE section');
    expect(liveSection.rows.map(({ gameId, clock, score }) => ({ gameId, clock, score }))).toEqual([
      { gameId: 'a', clock: 'Q2 5:00', score: '3–7' },
      { gameId: 'b', clock: 'LIVE', score: null },
    ]);
  });

  it('treats a game on the live list as LIVE before the slate catches up', () => {
    const kickedOff = game('g', EARLY, 'scheduled');
    const sections = board([kickedOff], { liveGames: [live(kickedOff)] });
    const liveSection = sectionOf(sections, 'live');
    expect(ids(liveSection)).toEqual(['g']);
    expect(liveSection?.kind === 'live' ? liveSection.rows[0]?.status : null).toBe('in_progress');
  });
});

describe('countLiveGames', () => {
  it('counts slate games in progress plus live-list games the slate has not caught up on', () => {
    const a = game('a', EARLY, 'in_progress');
    const b = game('b', EARLY, 'scheduled');
    const c = game('c', THU, 'final');
    expect(countLiveGames([a, b, c], [live(b)])).toBe(2);
  });

  it('does not count a game the slate already marks final', () => {
    const c = game('c', THU, 'final');
    expect(countLiveGames([c], [live(c)])).toBe(0);
  });
});
