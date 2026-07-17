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
        typicalLagSeconds: 8,
        preferred: true,
      },
    ]);
  });

  it('marks a paid broadcast eligible only when the user is subscribed', () => {
    const withSub = rankBroadcasts([broadcast('sunday_ticket', true)], new Set(['sunday_ticket']));
    expect(withSub[0]?.userHasSubscription).toBe(true);
    expect(withSub[0]?.preferred).toBe(true);

    const withoutSub = rankBroadcasts([broadcast('sunday_ticket', true)], new Set());
    expect(withoutSub[0]?.userHasSubscription).toBe(false);
    // Ineligible (paid, not subscribed) — no preferred at all.
    expect(withoutSub[0]?.preferred).toBe(false);
    expect(preferredBroadcast(withoutSub)).toBeNull();
  });

  it('orders eligible broadcasts before ineligible ones', () => {
    // paid+unsubscribed (ineligible) listed first in input, free (eligible) second.
    const ranked = rankBroadcasts(
      [broadcast('sunday_ticket', true), broadcast('nbc', false)],
      new Set(),
    );

    expect(ranked.map((b) => b.service)).toEqual(['nbc', 'sunday_ticket']);
    expect(ranked[0]?.preferred).toBe(true); // nbc, eligible
    expect(ranked[1]?.preferred).toBe(false); // sunday_ticket, ineligible
  });

  it('breaks ties among eligible broadcasts by lowest lag, then alphabetically', () => {
    // All eligible (user subscribed to all). Lags: espn_plus 60, fox 8, cbs 8.
    const ranked = rankBroadcasts(
      [broadcast('espn_plus', true), broadcast('fox', true), broadcast('cbs', true)],
      new Set(['espn_plus', 'fox', 'cbs']),
    );

    // fox & cbs both lag 8 -> alphabetical (cbs before fox); espn_plus (60) last.
    expect(ranked.map((b) => b.service)).toEqual(['cbs', 'fox', 'espn_plus']);
    expect(ranked[0]?.preferred).toBe(true);
    expect(ranked.filter((b) => b.preferred)).toHaveLength(1);
  });

  it('is deterministic regardless of input ordering', () => {
    const userServices = new Set(['sunday_ticket', 'fox', 'espn_plus']);
    const forward = rankBroadcasts(
      [broadcast('sunday_ticket', true), broadcast('fox', true), broadcast('espn_plus', true)],
      userServices,
    );
    const reversed = rankBroadcasts(
      [broadcast('espn_plus', true), broadcast('fox', true), broadcast('sunday_ticket', true)],
      userServices,
    );

    expect(forward).toEqual(reversed);
    expect(forward[0]?.service).toBe('fox'); // lowest lag (8) among the three eligible
  });

  it('prefers a low-lag eligible broadcast over a lower-lag ineligible one', () => {
    // fox (lag 8) is paid+unsubscribed -> ineligible; espn_plus (lag 60) is subscribed -> eligible.
    const ranked = rankBroadcasts(
      [broadcast('fox', true), broadcast('espn_plus', true)],
      new Set(['espn_plus']),
    );

    expect(preferredBroadcast(ranked)?.service).toBe('espn_plus');
    expect(ranked.map((b) => b.service)).toEqual(['espn_plus', 'fox']);
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
    catalog.setGameBroadcasts('g1', [broadcast('sunday_ticket', true), broadcast('fox', false)]);
    catalog.setUserSubscribedServices('u1', ['sunday_ticket']);

    const ranked = await resolveBroadcasts('g1', 'u1', catalog);

    // Both eligible (fox free, sunday_ticket subscribed); fox wins on lag (8 < 75).
    expect(ranked.map((b) => b.service)).toEqual(['fox', 'sunday_ticket']);
    expect(preferredBroadcast(ranked)?.service).toBe('fox');
  });

  it('returns an empty ranking when the catalog has no data for the game', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    expect(await resolveBroadcasts('missing', 'missing', catalog)).toEqual([]);
  });
});
