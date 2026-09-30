import { describe, expect, it } from 'vitest';

import { leagueChipScrollOffset, leagueChipWidth } from './leagueChipScroll';

/** Two chips + two gaps + a 30% peek fit this lane exactly. Chip width is 100. */
const INNER = 250;
const GAP = 10;
const CHIP = 100;
const VIEWPORT = INNER;

function offset(leagueCount: number, selectedIndex: number, currentOffset: number): number {
  return leagueChipScrollOffset({
    leagueCount,
    selectedIndex,
    chipWidth: CHIP,
    gap: GAP,
    viewportWidth: VIEWPORT,
    currentOffset,
  });
}

describe('leagueChipWidth', () => {
  it('fits two chips and a 30% peek of the third in the lane', () => {
    const width = leagueChipWidth(INNER, GAP);
    expect(width).toBeCloseTo(CHIP);
    expect(2 * width + 2 * GAP + 0.3 * width).toBeCloseTo(INNER);
  });
});

describe('leagueChipScrollOffset', () => {
  it('keeps the first chip of 3 or 5 at the start', () => {
    expect(offset(3, 0, 0)).toBe(0);
    expect(offset(5, 0, 0)).toBe(0);
  });

  it('does not scroll when the middle chip of 3 is already fully visible', () => {
    expect(offset(3, 1, 0)).toBe(0);
  });

  it('scrolls a 5-league row so the middle chip is fully visible with a 30% peek of the next', () => {
    expect(offset(5, 2, 0)).toBe(CHIP + GAP);
  });

  it('does not scroll when the selected chip is already fully visible', () => {
    expect(offset(5, 2, 150)).toBe(150);
  });

  it('clamps to the start when the first chip is off-screen to the left', () => {
    expect(offset(5, 0, 200)).toBe(0);
  });

  it('clamps the last chip flush with the end, with no empty space past the content', () => {
    const contentWidth = (count: number) => count * CHIP + (count - 1) * GAP;
    expect(offset(3, 2, 0)).toBe(contentWidth(3) - VIEWPORT);
    expect(offset(5, 4, 0)).toBe(contentWidth(5) - VIEWPORT);
  });
});
