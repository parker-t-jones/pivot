import { describe, expect, it } from 'vitest';

import {
  WATCHLIST_FILTERS,
  lineupScreenMode,
  splitBets,
  watchlistSections,
} from './watchlistFilter';

describe('watchlistSections', () => {
  it('offers All, Fantasy, Bets, and Pools, and leaves Markets out', () => {
    expect(WATCHLIST_FILTERS.map((filter) => filter.key)).toEqual([
      'all',
      'fantasy',
      'bets',
      'pools',
    ]);
  });

  it('All shows starters, then bets, then the opponent section', () => {
    expect(watchlistSections('all')).toEqual(['starters', 'bets', 'opponent']);
  });

  it('Fantasy shows league actions, league chips, starters, and the opponent section', () => {
    expect(watchlistSections('fantasy')).toEqual([
      'leagueActions',
      'leagueChips',
      'starters',
      'opponent',
    ]);
  });

  it('Bets shows non-survivor bets', () => {
    expect(watchlistSections('bets')).toEqual(['bets']);
    expect(
      splitBets([
        { id: 'spread', condition: { type: 'SPREAD' } },
        { id: 'pool', condition: { type: 'SURVIVOR' } },
      ]),
    ).toEqual({
      bets: [{ id: 'spread', condition: { type: 'SPREAD' } }],
      pools: [{ id: 'pool', condition: { type: 'SURVIVOR' } }],
    });
  });

  it('Pools shows survivor picks', () => {
    expect(watchlistSections('pools')).toEqual(['pools']);
  });

  it('flag off produces the legacy screen', () => {
    expect(lineupScreenMode(false)).toBe('legacy');
    expect(lineupScreenMode(true)).toBe('watchlist');
  });
});
