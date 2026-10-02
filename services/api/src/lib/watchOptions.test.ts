import { describe, expect, it } from 'vitest';
import { buildWeekWatch, type AiringRow, type SlateGameRow } from './watchOptions.js';

/** Week 3 shape: TNF on Prime, a 1pm FOX/CBS regional split, SNF on NBC, MNF on ESPN + ABC. */
const GAMES: SlateGameRow[] = [
  { id: 'tnf', scheduled_start: '2026-09-25T00:15:00Z', away_team_name: 'Packers', home_team_name: 'Lions' },
  { id: 'fox1', scheduled_start: '2026-09-27T17:00:00Z', away_team_name: 'Bears', home_team_name: 'Packers' },
  { id: 'fox2', scheduled_start: '2026-09-27T17:00:00Z', away_team_name: 'Cowboys', home_team_name: 'Giants' },
  { id: 'cbs1', scheduled_start: '2026-09-27T17:00:00Z', away_team_name: 'Bills', home_team_name: 'Dolphins' },
  { id: 'snf', scheduled_start: '2026-09-28T00:20:00Z', away_team_name: 'Chiefs', home_team_name: 'Ravens' },
  { id: 'mnf', scheduled_start: '2026-09-29T00:15:00Z', away_team_name: 'Eagles', home_team_name: 'Buccaneers' },
];

const FOX1_SEARCH = 'https://tv.youtube.com/search/Bears%20vs%20Packers';

function row(gameId: string, network: string, market = 'national'): AiringRow {
  return { game_id: gameId, network, market, espn_media_name: network.toUpperCase(), espn_type: 'TV' };
}

const AIRINGS: AiringRow[] = [
  row('tnf', 'amazon_prime'),
  row('fox1', 'fox'),
  row('fox2', 'fox'),
  row('cbs1', 'cbs'),
  row('snf', 'nbc'),
  row('mnf', 'abc'),
  row('mnf', 'espn'),
];

describe('buildWeekWatch', () => {
  it('YouTube TV only: nothing on TNF, an unknown-market FOX option at 1pm, ESPN on MNF', () => {
    const watch = buildWeekWatch(GAMES, AIRINGS, new Set(['youtube_tv']));

    expect(watch.get('tnf')?.broadcasts).toEqual([]);
    expect(watch.get('fox1')?.broadcasts).toEqual([
      {
        service: 'youtube_tv',
        deep_link_url: FOX1_SEARCH,
        requires_subscription: true,
        user_has_subscription: true,
        typical_lag_seconds: 30,
        preferred: true,
        network: 'fox',
        market_confidence: 'unknown',
      },
    ]);
    expect(watch.get('mnf')?.broadcasts).toEqual([
      expect.objectContaining({ service: 'youtube_tv', network: 'espn', market_confidence: 'national', preferred: true }),
    ]);
  });

  it('lists every airing per game in board-label order, regional CBS/FOX as unknown market', () => {
    const watch = buildWeekWatch(GAMES, AIRINGS, new Set());

    expect(watch.get('mnf')?.airings).toEqual([
      { network: 'espn', market: 'national', market_confidence: 'national' },
      { network: 'abc', market: 'national', market_confidence: 'national' },
    ]);
    expect(watch.get('fox1')?.airings).toEqual([
      { network: 'fox', market: 'national', market_confidence: 'unknown' },
    ]);
    expect(watch.get('tnf')?.airings).toEqual([
      { network: 'amazon_prime', market: 'national', market_confidence: 'national' },
    ]);
  });

  it('gives a user with no services no options, not a free network row', () => {
    const watch = buildWeekWatch(GAMES, AIRINGS, new Set());
    for (const game of GAMES) expect(watch.get(game.id)?.broadcasts).toEqual([]);
  });

  it('ranks Ticket first and YouTube TV second with the in-market hint on a regional FOX game', () => {
    const watch = buildWeekWatch(GAMES, AIRINGS, new Set(['youtube_tv', 'sunday_ticket']));

    expect(watch.get('fox1')?.broadcasts).toEqual([
      {
        service: 'sunday_ticket',
        deep_link_url: FOX1_SEARCH,
        requires_subscription: true,
        user_has_subscription: true,
        typical_lag_seconds: 30,
        preferred: true,
        network: 'fox',
        market_confidence: 'out',
      },
      {
        service: 'youtube_tv',
        deep_link_url: FOX1_SEARCH,
        requires_subscription: true,
        user_has_subscription: true,
        typical_lag_seconds: 30,
        preferred: false,
        network: 'fox',
        market_confidence: 'unknown',
        route_hint: 'in_market_local',
      },
    ]);
    // Ticket is Sunday-afternoon CBS/FOX only.
    expect(watch.get('snf')?.broadcasts.map((o) => o.service)).toEqual(['youtube_tv']);
  });

  it('treats a lone game in its CBS/FOX window as national', () => {
    const watch = buildWeekWatch(
      [{ id: 'solo', scheduled_start: '2026-09-27T17:00:00Z', away_team_name: 'Bears', home_team_name: 'Packers' }],
      [row('solo', 'fox')],
      new Set(['youtube_tv', 'sunday_ticket']),
    );
    const solo = watch.get('solo');
    expect(solo?.airings).toEqual([{ network: 'fox', market: 'national', market_confidence: 'national' }]);
    expect(solo?.broadcasts.every((o) => o.market_confidence === 'national')).toBe(true);
    expect(solo?.broadcasts.some((o) => o.route_hint !== undefined)).toBe(false);
  });

  it('ignores airing rows with a network outside the catalog', () => {
    const watch = buildWeekWatch([GAMES[0] as SlateGameRow], [row('tnf', 'dumont')], new Set(['youtube_tv']));
    expect(watch.get('tnf')).toEqual({ broadcasts: [], airings: [] });
  });
});
