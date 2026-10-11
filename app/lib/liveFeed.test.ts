import { describe, expect, it } from 'vitest';
import { theme } from './theme';
import { LIVE_FEED_PAUSED_BANNER, flaggedCardsOpacity, liveFeedBanner } from './liveFeed';

describe('live feed paused banner', () => {
  it('shows the muted banner only when live_feed_ok is false', () => {
    expect(liveFeedBanner(false)).toBe(LIVE_FEED_PAUSED_BANNER);
    expect(LIVE_FEED_PAUSED_BANNER).toBe('Live updates paused — reconnecting');
    expect(liveFeedBanner(undefined)).toBeNull();
    expect(liveFeedBanner(true)).toBeNull();
  });

  it('dims Now Active and Also Flagged only while the banner is showing', () => {
    expect(flaggedCardsOpacity(false)).toBe(theme.opacity.disabled);
    expect(flaggedCardsOpacity(undefined)).toBe(1);
    expect(flaggedCardsOpacity(true)).toBe(1);
  });
});
