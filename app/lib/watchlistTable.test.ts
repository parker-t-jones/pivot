import { describe, expect, it } from 'vitest';

import { watchlistPlayerRow, type WatchlistTableGame } from './watchlistTable';

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
    expect(row.game).toContain('@ SEA');
    expect(row.network).toBe('CBS');
    expect(row.status).toBe('Upcoming');
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
    expect(row.game).toBe('@ SEA · 10–21');
    expect(row.status).toContain('Q3');
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
    expect(row.game.startsWith('vs SF')).toBe(true);
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
    expect(row.live).toBe(false);
    expect(row.gameId).toBeNull();
  });
});
