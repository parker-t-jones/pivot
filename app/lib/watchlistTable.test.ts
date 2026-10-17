import { describe, expect, it } from 'vitest';

import { watchlistPlayerRow, watchlistStatusLabel, type WatchlistTableGame } from './watchlistTable';

const NOW = new Date('2026-10-11T17:00:00.000Z');

function game(overrides: Partial<WatchlistTableGame> = {}): WatchlistTableGame {
  return {
    game_id: 'g1',
    status: 'scheduled',
    scheduled_start: '2026-10-12T17:00:00.000Z',
    home_team: 'SEA',
    away_team: 'SF',
    airings: [{ network: 'cbs' }],
    broadcasts: [{ preferred: true, deep_link_url: 'https://tv.youtube.com/watch/abc' }],
    ...overrides,
  };
}

describe('watchlistPlayerRow', () => {
  it('keeps a scheduled row on the kickoff and the network', () => {
    const row = watchlistPlayerRow({
      id: 'slot-1',
      slot: 'WR',
      name: 'Davante Adams',
      meta: 'LAR · WR',
      teamAbbr: 'SF',
      weekGames: [game()],
      liveGames: [],
      now: NOW,
      timeZone: 'America/New_York',
    });
    expect(row.game).toBe('SF @ SEA');
    expect(row.awayTeam).toBe('SF');
    expect(row.homeTeam).toBe('SEA');
    expect(row.network).toBe('CBS');
    expect(row.status).toBe('in 24h 0m');
    expect(row.live).toBe(false);
    expect(row.deepLinkUrl).toBe('https://tv.youtube.com/watch/abc');
  });

  it('marks an in-progress row live and shows the score', () => {
    const row = watchlistPlayerRow({
      id: 'slot-1',
      slot: 'QB',
      name: 'Brock Purdy',
      meta: 'SF · QB',
      teamAbbr: 'SF',
      weekGames: [game({ status: 'in_progress' })],
      liveGames: [
        {
          game_id: 'g1',
          score: { away: 10, home: 21 },
          quarter: 3,
          time_remaining_sec: 455,
        },
      ],
      now: NOW,
      timeZone: 'America/New_York',
    });
    expect(row.live).toBe(true);
    expect(row.game).toBe('SF @ SEA');
    expect(row.status).toBe('10–21 · Q3 7:35');
    expect(row.statusMuted).toBe(false);
    expect(row.deepLinkUrl).toBe('https://tv.youtube.com/watch/abc');
  });

  it('drops a custom-scheme watch URL', () => {
    const row = watchlistPlayerRow({
      id: 'slot-1',
      slot: 'RB',
      name: 'James Cook',
      meta: 'BUF · RB',
      teamAbbr: 'SEA',
      weekGames: [
        game({
          broadcasts: [{ preferred: true, deep_link_url: 'sportscenter://watch' }],
        }),
      ],
      liveGames: [],
      now: NOW,
      timeZone: 'America/New_York',
    });
    expect(row.deepLinkUrl).toBeNull();
    expect(row.game).toBe('SF @ SEA');
  });

  it('calls a missing game a bye', () => {
    const row = watchlistPlayerRow({
      id: 'slot-1',
      slot: 'DEF',
      name: 'Patriots',
      meta: 'NE · DEF',
      teamAbbr: 'NE',
      weekGames: [game()],
      liveGames: [],
      now: NOW,
      timeZone: 'America/New_York',
    });
    expect(row.status).toBe('BYE');
    expect(row.statusMuted).toBe(true);
    expect(row.live).toBe(false);
    expect(row.gameId).toBeNull();
  });
});

describe('watchlistStatusLabel', () => {
  const now = new Date('2026-10-11T16:00:00.000Z');

  it('counts down inside a day and uses an Eastern weekday past a day', () => {
    const soon = watchlistStatusLabel({
      bye: false,
      isFinal: false,
      inProgress: false,
      kickoff: new Date('2026-10-11T17:07:00.000Z'),
      now,
      live: null,
    });
    expect(soon).toEqual({ text: 'in 1h 7m', muted: false });

    const later = watchlistStatusLabel({
      bye: false,
      isFinal: false,
      inProgress: false,
      kickoff: new Date('2026-10-13T17:00:00.000Z'),
      now,
      live: null,
    });
    expect(later.muted).toBe(false);
    expect(later.text.startsWith('in ')).toBe(false);
    expect(later.text).toMatch(/^TUE /);
  });

  it('shows the live score and clock, or LIVE when the feed has no clock', () => {
    expect(
      watchlistStatusLabel({
        bye: false,
        isFinal: false,
        inProgress: true,
        kickoff: now,
        now,
        live: { game_id: 'g', score: { away: 3, home: 10 }, quarter: 2, time_remaining_sec: 0 },
      }).text,
    ).toBe('3–10 · HALF');
    expect(
      watchlistStatusLabel({
        bye: false,
        isFinal: false,
        inProgress: true,
        kickoff: now,
        now,
        live: null,
      }),
    ).toEqual({ text: 'LIVE', muted: false });
  });

  it('marks a final game muted without inventing a score', () => {
    expect(
      watchlistStatusLabel({
        bye: false,
        isFinal: true,
        inProgress: false,
        kickoff: now,
        now,
        live: null,
      }),
    ).toEqual({ text: 'FINAL', muted: true });
  });
});
