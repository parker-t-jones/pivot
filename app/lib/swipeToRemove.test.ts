import { describe, expect, it } from 'vitest';

import {
  SWIPE_CAPTURE_DX,
  SWIPE_MIN_TRAVEL,
  swipeDecision,
  swipeShouldCapture,
} from './swipeToRemove';

describe('swipeShouldCapture', () => {
  it('claims a clear left swipe', () => {
    expect(swipeShouldCapture(-40, 5)).toBe(true);
  });

  it('leaves small moves, right swipes, and vertical scrolls to the scroll view', () => {
    expect(swipeShouldCapture(-(SWIPE_CAPTURE_DX - 1), 0)).toBe(false);
    expect(swipeShouldCapture(60, 0)).toBe(false);
    expect(swipeShouldCapture(-30, 40)).toBe(false);
    // Diagonal but not clearly horizontal (needs 1.5×).
    expect(swipeShouldCapture(-30, 25)).toBe(false);
  });
});

describe('swipeDecision', () => {
  const width = 358;

  it('removes past 40% of the row', () => {
    expect(swipeDecision(-width * 0.41, 0, width)).toBe('remove');
    expect(swipeDecision(-width * 0.39, 0, width)).toBe('settle');
  });

  it('removes on a fast short flick left, but not a tiny twitch', () => {
    expect(swipeDecision(-40, -1.2, width)).toBe('remove');
    expect(swipeDecision(-10, -2, width)).toBe('settle');
  });

  it('never removes on a right swipe or a slow partial drag', () => {
    expect(swipeDecision(200, 2, width)).toBe('settle');
    expect(swipeDecision(-80, -0.2, width)).toBe('settle');
  });

  it('uses the minimum travel before the row has measured', () => {
    expect(swipeDecision(-(SWIPE_MIN_TRAVEL - 1), 0, 0)).toBe('settle');
    expect(swipeDecision(-SWIPE_MIN_TRAVEL, 0, 0)).toBe('remove');
  });
});
