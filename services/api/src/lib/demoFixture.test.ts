import { describe, expect, it } from 'vitest';
import {
  DEMO_FINAL_GAME_ID,
  DEMO_LIVE_GAME_ID,
  DEMO_STAKE_MONEYLINE_ID,
  DEMO_STAKE_SPREAD_ID,
  DEMO_UPCOMING_GAME_ID,
  demoFlagsResponse,
  demoLiveResponse,
  demoStakesResponse,
  demoWeekResponse,
} from './demoFixture.js';

const NOW = new Date('2026-10-31T20:00:00.000Z');

describe('demo fixture', () => {
  it('anchors three games to now and resolves the live CBS game for DIRECTV', () => {
    const body = demoWeekResponse(7, new Set(['directv']), NOW);
    expect(body.week).toBe(7);
    expect(body.games.map((game) => game.game_id)).toEqual([
      DEMO_LIVE_GAME_ID,
      DEMO_UPCOMING_GAME_ID,
      DEMO_FINAL_GAME_ID,
    ]);
    const live = body.games[0];
    const upcoming = body.games[1];
    const finalGame = body.games[2];
    if (!live || !upcoming || !finalGame) throw new Error('expected three games');
    expect(live.status).toBe('in_progress');
    expect(live.scheduled_start).toBe(new Date(NOW.getTime() - 90 * 60 * 1000).toISOString());
    expect(upcoming.status).toBe('scheduled');
    expect(upcoming.scheduled_start).toBe(
      new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    );
    expect(finalGame.status).toBe('final');
    expect(live.destination).toMatchObject({
      kind: 'destinations',
      primary: { url: 'https://www.cbs.com/live-tv/stream/' },
    });
  });

  it('returns one live red-zone snapshot and two picks on that game', () => {
    const live = demoLiveResponse(NOW).games[0];
    expect(live?.game_id).toBe(DEMO_LIVE_GAME_ID);
    expect(live?.quarter).toBe(2);
    expect(live?.time_remaining_sec).toBe(7 * 60 + 14);
    expect(live?.in_red_zone).toBe(true);
    expect(live?.possession_team).toBe('KC');
    expect(live?.score).toEqual({ home: 17, away: 10 });

    const flags = demoFlagsResponse(NOW);
    expect(flags.live_feed_ok).toBe(true);
    expect(flags.flags[0]?.reasons).toEqual(['red_zone']);
    expect(flags.flags[0]?.flagged_players.map((player) => player.last_name)).toEqual([
      'Hart',
      'Kemp',
    ]);

    const stakes = demoStakesResponse('user-1', 2026, 7, NOW);
    expect(stakes.stakes.map((stake) => stake.id)).toEqual([
      DEMO_STAKE_SPREAD_ID,
      DEMO_STAKE_MONEYLINE_ID,
    ]);
    expect(stakes.stakes.every((stake) => stake.game_id === DEMO_LIVE_GAME_ID)).toBe(true);
    expect(stakes.stakes[0]?.game?.home_team).toBe('KC');
  });
});
