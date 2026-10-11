import { theme } from './theme';

/** Home copy when `/flags/current` reports `live_feed_ok: false`. */
export const LIVE_FEED_PAUSED_BANNER = 'Live updates paused — reconnecting';

/**
 * Banner for the latest `/flags/current` body. `false` is the only paused state: a missing key
 * (pre-game, off-day) and `true` both show nothing. Call again on every refetch.
 */
export function liveFeedBanner(liveFeedOk: boolean | undefined): string | null {
  return liveFeedOk === false ? LIVE_FEED_PAUSED_BANNER : null;
}

/**
 * Opacity for the Now Active and Also Flagged cards. Dims with the paused banner; otherwise full.
 * Uses the existing disabled opacity token.
 */
export function flaggedCardsOpacity(liveFeedOk: boolean | undefined): number {
  return liveFeedOk === false ? theme.opacity.disabled : 1;
}
