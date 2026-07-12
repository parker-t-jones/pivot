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
  it('matches PLAN.md Section 8 verbatim', () => {
    expect(BROADCAST_LAG_SECONDS).toEqual({
      sunday_ticket: 75,
      espn_plus: 60,
      paramount_plus: 50,
      peacock: 45,
      amazon_prime: 40,
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
    expect(pickBroadcastSource([broadcast('sunday_ticket')], new Set(['espn_plus']))).toBeNull();
  });

  it('returns the only matching candidate', () => {
    expect(
      pickBroadcastSource(
        [broadcast('fox'), broadcast('sunday_ticket')],
        new Set(['sunday_ticket']),
      ),
    ).toBe('sunday_ticket');
  });

  it('prefers the lowest-lag candidate — broadcast TV over paid streaming', () => {
    const broadcasts = [broadcast('sunday_ticket'), broadcast('fox'), broadcast('espn_plus')];
    const userServices = new Set(['sunday_ticket', 'fox', 'espn_plus']);
    expect(pickBroadcastSource(broadcasts, userServices)).toBe('fox'); // lag 8 < 60 < 75
  });

  it('breaks ties on equal lag alphabetically by service name', () => {
    // fox and cbs both have lag 8 — alphabetical tie-break picks 'cbs'.
    const broadcasts = [broadcast('fox'), broadcast('cbs')];
    const userServices = new Set(['fox', 'cbs']);
    expect(pickBroadcastSource(broadcasts, userServices)).toBe('cbs');
  });

  it('is deterministic regardless of input ordering', () => {
    const userServices = new Set(['sunday_ticket', 'fox', 'espn_plus']);
    const forward = pickBroadcastSource(
      [broadcast('sunday_ticket'), broadcast('fox'), broadcast('espn_plus')],
      userServices,
    );
    const reversed = pickBroadcastSource(
      [broadcast('espn_plus'), broadcast('fox'), broadcast('sunday_ticket')],
      userServices,
    );
    expect(forward).toBe(reversed);
  });
});

describe('resolveLikelyBroadcastSource (I/O wrapper)', () => {
  it('intersects the catalog game broadcasts with the user app presence', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setGameBroadcasts('g1', [broadcast('sunday_ticket'), broadcast('fox')]);
    catalog.setUserSubscribedServices('u1', ['fox']);

    expect(await resolveLikelyBroadcastSource('g1', 'u1', catalog)).toBe('fox');
  });

  it('returns null when the catalog has no data for the game or user', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    expect(await resolveLikelyBroadcastSource('missing-game', 'missing-user', catalog)).toBeNull();
  });
});
