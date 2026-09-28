import { describe, expect, it } from 'vitest';
import { InMemoryBroadcastCatalog, type GameBroadcastOption } from './broadcastLag.js';
import { preferredBroadcast, rankBroadcasts, resolveBroadcasts } from './broadcastResolver.js';

function broadcast(
  service: string,
  requiresSubscription: boolean,
): GameBroadcastOption {
  return { service, deepLinkUrl: `https://example.com/${service}`, requiresSubscription };
}

describe('rankBroadcasts', () => {
  it('returns an empty list for a game with no broadcasts', () => {
    expect(rankBroadcasts([], new Set())).toEqual([]);
  });

  it('marks a free broadcast eligible even with no subscription, and prefers it', () => {
    const ranked = rankBroadcasts([broadcast('fox', false)], new Set());

    expect(ranked).toEqual([
      {
        service: 'fox',
        deepLinkUrl: 'https://example.com/fox',
        requiresSubscription: false,
        userHasSubscription: false,
        typicalLagSeconds: 60,
        preferred: true,
      },
    ]);
  });

  it('marks a paid broadcast eligible only when the user is subscribed', () => {
    const withSub = rankBroadcasts([broadcast('amazon_prime', true)], new Set(['amazon_prime']));
    expect(withSub[0]?.userHasSubscription).toBe(true);
    expect(withSub[0]?.preferred).toBe(true);

    const withoutSub = rankBroadcasts([broadcast('amazon_prime', true)], new Set());
    expect(withoutSub[0]?.userHasSubscription).toBe(false);
    // Ineligible (paid, not subscribed) — no preferred at all.
    expect(withoutSub[0]?.preferred).toBe(false);
    expect(preferredBroadcast(withoutSub)).toBeNull();
  });

  it('does not match a network row against an MVPD user service (no carriage until B1.4)', () => {
    const ranked = rankBroadcasts([broadcast('espn', true)], new Set(['youtube_tv']));
    expect(ranked[0]?.userHasSubscription).toBe(false);
    expect(preferredBroadcast(ranked)).toBeNull();
  });

  it('orders eligible broadcasts before ineligible ones', () => {
    // paid+unsubscribed (ineligible) listed first in input, free (eligible) second.
    const ranked = rankBroadcasts(
      [broadcast('amazon_prime', true), broadcast('nbc', false)],
      new Set(),
    );

    expect(ranked.map((b) => b.service)).toEqual(['nbc', 'amazon_prime']);
    expect(ranked[0]?.preferred).toBe(true); // nbc, eligible
    expect(ranked[1]?.preferred).toBe(false); // amazon_prime, ineligible
  });

  it('breaks ties among eligible broadcasts by lowest lag, then alphabetically', () => {
    // All eligible (cbs free, espn_plus/amazon_prime subscribed). Lags: amazon_prime 40,
    // espn_plus 60, cbs 60 (networks fall back to the default).
    const ranked = rankBroadcasts(
      [broadcast('espn_plus', true), broadcast('cbs', false), broadcast('amazon_prime', true)],
      new Set(['espn_plus', 'amazon_prime']),
    );

    // amazon_prime (40) first; cbs & espn_plus both 60 -> alphabetical.
    expect(ranked.map((b) => b.service)).toEqual(['amazon_prime', 'cbs', 'espn_plus']);
    expect(ranked[0]?.preferred).toBe(true);
    expect(ranked.filter((b) => b.preferred)).toHaveLength(1);
  });

  it('is deterministic regardless of input ordering', () => {
    const userServices = new Set(['amazon_prime', 'espn_plus']);
    const forward = rankBroadcasts(
      [broadcast('amazon_prime', true), broadcast('fox', false), broadcast('espn_plus', true)],
      userServices,
    );
    const reversed = rankBroadcasts(
      [broadcast('espn_plus', true), broadcast('fox', false), broadcast('amazon_prime', true)],
      userServices,
    );

    expect(forward).toEqual(reversed);
    expect(forward[0]?.service).toBe('amazon_prime'); // lowest lag (40) among the three eligible
  });

  it('prefers a low-lag eligible broadcast over a lower-lag ineligible one', () => {
    // amazon_prime (lag 40) is paid+unsubscribed -> ineligible; espn_plus (lag 60) is subscribed.
    const ranked = rankBroadcasts(
      [broadcast('amazon_prime', true), broadcast('espn_plus', true)],
      new Set(['espn_plus']),
    );

    expect(preferredBroadcast(ranked)?.service).toBe('espn_plus');
    expect(ranked.map((b) => b.service)).toEqual(['espn_plus', 'amazon_prime']);
  });
});

describe('preferredBroadcast', () => {
  it('returns null for an empty ranking', () => {
    expect(preferredBroadcast([])).toBeNull();
  });
});

describe('resolveBroadcasts (I/O wrapper)', () => {
  it('ranks the catalog broadcasts against the user subscribed services', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setGameBroadcasts('g1', [broadcast('amazon_prime', true), broadcast('fox', false)]);
    catalog.setUserSubscribedServices('u1', ['amazon_prime']);

    const ranked = await resolveBroadcasts('g1', 'u1', catalog);

    // Both eligible (fox free, amazon_prime subscribed); amazon_prime wins on lag (40 < 60).
    expect(ranked.map((b) => b.service)).toEqual(['amazon_prime', 'fox']);
    expect(preferredBroadcast(ranked)?.service).toBe('amazon_prime');
  });

  it('returns an empty ranking when the catalog has no data for the game', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    expect(await resolveBroadcasts('missing', 'missing', catalog)).toEqual([]);
  });
});
