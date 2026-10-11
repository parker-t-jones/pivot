import { describe, expect, it } from 'vitest';

import { watchedStarterCount, weekCardModel, type WeekCardInputs } from './weekCardModel';

const free: WeekCardInputs = {
  starterCount: 9,
  watchOpponent: false,
  betCount: 0,
  survivorCount: 1,
  isPro: false,
};

describe('weekCardModel', () => {
  it('shows 0 of 3 free for a Free user with no bets', () => {
    expect(weekCardModel(free).bets).toEqual({
      label: 'Bets & props',
      value: '0 of 3 free',
      accent: true,
      muted: false,
    });
  });

  it('shows 2 of 3 free', () => {
    expect(weekCardModel({ ...free, betCount: 2 }).bets.value).toBe('2 of 3 free');
  });

  it('shows 3 of 3 free', () => {
    expect(weekCardModel({ ...free, betCount: 3 }).bets.value).toBe('3 of 3 free');
  });

  it('shows the plain count for Pro', () => {
    expect(weekCardModel({ ...free, betCount: 4, isPro: true }).bets).toEqual({
      label: 'Bets & props',
      value: '4',
      accent: false,
      muted: false,
    });
  });

  it('says Tracking when opponent watch is on and Off when it is not', () => {
    expect(weekCardModel({ ...free, watchOpponent: true }).opponent.value).toBe('Tracking');
    expect(weekCardModel(free).opponent.value).toBe('Off');
  });

  it('counts zero starters when there are no leagues', () => {
    expect(watchedStarterCount([], [])).toBe(0);
    expect(weekCardModel({ ...free, starterCount: 0 }).fantasy).toEqual({
      label: 'Fantasy',
      value: '0',
      accent: false,
      muted: false,
    });
  });

  it('counts starters on watched leagues and skips bench slots', () => {
    const lineups = [
      {
        leagueId: 'watched',
        slots: [
          { slot_type: 'starter', position_in_lineup: 'QB' },
          { slot_type: 'flex', position_in_lineup: 'FLEX' },
          { slot_type: 'bench', position_in_lineup: 'BN' },
        ],
      },
      {
        leagueId: 'other',
        slots: [{ slot_type: 'starter', position_in_lineup: 'RB' }],
      },
    ];
    expect(watchedStarterCount(lineups, ['watched'])).toBe(2);
    expect(watchedStarterCount(lineups, [])).toBe(3);
  });

  it('renders an em dash for a failed fantasy count and leaves the other cells', () => {
    const model = weekCardModel({ ...free, starterCount: null });
    expect(model.fantasy).toEqual({
      label: 'Fantasy',
      value: '\u2014',
      accent: false,
      muted: true,
    });
    expect(model.opponent.value).toBe('Off');
    expect(model.bets.value).toBe('0 of 3 free');
    expect(model.pools.value).toBe('1');
  });

  it('renders an em dash for a failed bet count and does not say of 3 free', () => {
    const model = weekCardModel({ ...free, betCount: null, isPro: false });
    expect(model.bets).toEqual({
      label: 'Bets & props',
      value: '\u2014',
      accent: false,
      muted: true,
    });
    expect(model.bets.value).not.toContain('free');
    expect(model.fantasy.value).toBe('9');
    expect(model.opponent.value).toBe('Off');
    expect(model.pools.value).toBe('1');
  });

  it('renders an em dash for a failed pool count', () => {
    expect(weekCardModel({ ...free, survivorCount: null }).pools).toEqual({
      label: 'Pools',
      value: '\u2014',
      accent: false,
      muted: true,
    });
  });
});
