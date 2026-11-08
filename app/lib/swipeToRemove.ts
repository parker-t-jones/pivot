/**
 * Thresholds for the phone Watchlist's swipe-left-to-remove (issue #14). Pure so the gesture
 * rules are testable without a touch screen.
 */

/** Horizontal travel before the row claims the gesture. Smaller moves stay with the scroll view. */
export const SWIPE_CAPTURE_DX = 12;
/** A swipe must be this much more horizontal than vertical before it claims the gesture. */
export const SWIPE_DIRECTION_RATIO = 1.5;
/** Release past this share of the row's width removes it. */
export const SWIPE_REMOVE_FRACTION = 0.4;
/** Floor for the remove distance on a very narrow row, and the slide-out distance before layout. */
export const SWIPE_MIN_TRAVEL = 96;
/** A fast flick left removes even when it is short (px per ms, PanResponder's `vx`). */
export const SWIPE_FLICK_VX = 0.8;

/** Left only, and clearly horizontal, so vertical scrolling and right swipes are untouched. */
export function swipeShouldCapture(dx: number, dy: number): boolean {
  if (dx > -SWIPE_CAPTURE_DX) return false;
  return Math.abs(dx) > Math.abs(dy) * SWIPE_DIRECTION_RATIO;
}

export function swipeDecision(dx: number, vx: number, rowWidth: number): 'remove' | 'settle' {
  if (dx >= 0) return 'settle';
  const distance = Math.max(SWIPE_MIN_TRAVEL, rowWidth * SWIPE_REMOVE_FRACTION);
  if (-dx >= distance) return 'remove';
  if (vx <= -SWIPE_FLICK_VX && -dx >= SWIPE_CAPTURE_DX * 2) return 'remove';
  return 'settle';
}
