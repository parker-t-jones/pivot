import { describe, expect, it } from 'vitest';

import { TOUR_CARDS, tourHasNextCard } from './tourCards';

describe('TOUR_CARDS', () => {
  it('has exactly 4 cards, never says "stake" in user copy, and never promises never spoiled', () => {
    expect(TOUR_CARDS).toHaveLength(4);
    for (const card of TOUR_CARDS) {
      expect(card.title.toLowerCase()).not.toContain('stake');
      expect(card.body.toLowerCase()).not.toContain('stake');
      expect(card.body.toLowerCase()).not.toContain('never spoiled');
      expect(card.body.toLowerCase()).not.toContain("never shows up in a notification");
    }
  });

  it('points to Settings → Alert timing on the alerts card instead of promising never spoiled', () => {
    const alertsCard = TOUR_CARDS.find((card) => card.id === 'alerts');
    expect(alertsCard?.body).toContain('Alert timing in Settings');
  });
});

describe('tourHasNextCard', () => {
  it('is true for every index before the last card', () => {
    expect(tourHasNextCard(0)).toBe(true);
    expect(tourHasNextCard(TOUR_CARDS.length - 2)).toBe(true);
  });

  it('is false on the last card', () => {
    expect(tourHasNextCard(TOUR_CARDS.length - 1)).toBe(false);
  });
});
