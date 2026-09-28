import { describe, expect, it } from 'vitest';
import {
  BROADCAST_LAG_SECONDS,
  DEFAULT_LAG_SECONDS,
  InMemoryBroadcastCatalog,
  lagSecondsFor,
  pickBroadcastSource,
  resolveLikelyBroadcastSource,
} from './broadcastLag.js';

describe('BROADCAST_LAG_SECONDS', () => {
  it('matches PLAN.md Section 8, with hulu renamed hulu_live', () => {
    expect(BROADCAST_LAG_SECONDS).toEqual({
      sunday_ticket: 75,
      espn_plus: 60,
      paramount_plus: 50,
      peacock: 45,
      amazon_prime: 40,
      hulu_live: 45,
      fubo: 50,
      directv: 40,
      nfl_plus: 60,
      nfl_network: 20,
      fox: 8,
      cbs: 8,
      nbc: 8,
      abc: 8,
    });
  });
});

describe('lagSecondsFor', () => {
  it('looks up a known service', () => {
    expect(lagSecondsFor('sunday_ticket')).toBe(75);
  });

  it('falls back to 60 for an unknown service', () => {
    expect(lagSecondsFor('some_future_service')).toBe(DEFAULT_LAG_SECONDS);
  });

  it('falls back to 60 for a null (unresolved) source', () => {
    expect(lagSecondsFor(null)).toBe(DEFAULT_LAG_SECONDS);
  });
});

function broadcast(service: string) {
  return { service, deepLinkUrl: `https://example.com/${service}`, requiresSubscription: true };
}

describe('pickBroadcastSource (deterministic tie-break)', () => {
  it('returns null when the user has none of the airing services', () => {
    expect(pickBroadcastSource([broadcast('amazon_prime')], new Set(['espn_plus']))).toBeNull();
  });

  it('never matches a network against an MVPD until carriage expansion (B1.4)', () => {
    expect(pickBroadcastSource([broadcast('fox')], new Set(['youtube_tv']))).toBeNull();
  });

  it('returns the only matching candidate', () => {
    expect(
      pickBroadcastSource(
        [broadcast('fox'), broadcast('amazon_prime')],
        new Set(['amazon_prime']),
      ),
    ).toBe('amazon_prime');
  });

  it('prefers the lowest-lag candidate', () => {
    const broadcasts = [broadcast('espn_plus'), broadcast('amazon_prime'), broadcast('peacock')];
    const userServices = new Set(['espn_plus', 'amazon_prime', 'peacock']);
    expect(pickBroadcastSource(broadcasts, userServices)).toBe('amazon_prime'); // lag 40 < 45 < 60
  });

  it('breaks ties on equal lag alphabetically by service name', () => {
    // nfl_plus and espn_plus both have lag 60 — alphabetical tie-break picks 'espn_plus'.
    const broadcasts = [broadcast('nfl_plus'), broadcast('espn_plus')];
    const userServices = new Set(['nfl_plus', 'espn_plus']);
    expect(pickBroadcastSource(broadcasts, userServices)).toBe('espn_plus');
  });

  it('is deterministic regardless of input ordering', () => {
    const userServices = new Set(['espn_plus', 'amazon_prime', 'peacock']);
    const forward = pickBroadcastSource(
      [broadcast('espn_plus'), broadcast('amazon_prime'), broadcast('peacock')],
      userServices,
    );
    const reversed = pickBroadcastSource(
      [broadcast('peacock'), broadcast('amazon_prime'), broadcast('espn_plus')],
      userServices,
    );
    expect(forward).toBe(reversed);
  });
});

describe('resolveLikelyBroadcastSource (I/O wrapper)', () => {
  it('intersects the catalog game broadcasts with the user app presence', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setGameBroadcasts('g1', [broadcast('fox'), broadcast('amazon_prime')]);
    catalog.setUserSubscribedServices('u1', ['amazon_prime']);

    expect(await resolveLikelyBroadcastSource('g1', 'u1', catalog)).toBe('amazon_prime');
  });

  it('returns null when the catalog has no data for the game or user', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    expect(await resolveLikelyBroadcastSource('missing-game', 'missing-user', catalog)).toBeNull();
  });
});
