import { describe, expect, it } from 'vitest';
import type { CoachMarkId } from '@pivot/shared/preferences';

import { pickCoachMarkToShow } from './coachMarks';

const HOME: CoachMarkId = 'home-segmented-control';
const WATCHLIST: CoachMarkId = 'watchlist-week-card';

describe('pickCoachMarkToShow', () => {
  it('returns the first candidate not yet seen', () => {
    expect(pickCoachMarkToShow([HOME], [])).toBe(HOME);
  });

  it('returns null once every candidate for this screen has been seen', () => {
    expect(pickCoachMarkToShow([HOME], [HOME])).toBeNull();
  });

  it('never returns more than one id — only the first unseen candidate', () => {
    expect(pickCoachMarkToShow([HOME, WATCHLIST], [])).toBe(HOME);
    expect(pickCoachMarkToShow([HOME, WATCHLIST], [HOME])).toBe(WATCHLIST);
    expect(pickCoachMarkToShow([HOME, WATCHLIST], [HOME, WATCHLIST])).toBeNull();
  });
});
