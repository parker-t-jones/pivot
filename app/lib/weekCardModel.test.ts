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
});
