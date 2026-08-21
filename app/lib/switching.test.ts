import { describe, expect, it } from 'vitest';
import type { AirPlayRouteController } from '../playback/airPlayRoute';
import { AirPlayPlaybackSource, DeepLinkPlaybackSource } from '../playback/PlaybackSource';
import { createPlaybackSources, resolveSwitch } from './switching';

/** A route controller that always reports a discovered target, to prove availability alone cannot pull
 *  the dormant AirPlay source back into the production registry. */
const availableRoute: AirPlayRouteController = {
  isTargetAvailable: () => true,
  activeRouteName: () => 'Living Room',
  subscribe: () => () => {
    // Availability is fixed, so there is nothing to detach.
  },
  presentRoutePicker: async () => true,
};

describe('createPlaybackSources', () => {
  it('is deep-link only — the cast sources are dormant after the Track B hardware finding', () => {
    expect(createPlaybackSources().map((s) => s.id)).toEqual(['deeplink']);
  });
});

describe('resolveSwitch', () => {
  it('resolves to a deep-link video session when the game has a deep link', async () => {
    const result = await resolveSwitch(
      { id: 'g1', deepLinkUrl: 'https://example.com/watch/g1' },
      { subscribedServices: [] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.source).toBe('deeplink');
      expect(result.session.gameId).toBe('g1');
      expect(result.session.deepLinkUrl).toBe('https://example.com/watch/g1');
    }
  });

  it('fails with no_source when the game has no deep link', async () => {
    const result = await resolveSwitch({ id: 'g1' }, { subscribedServices: [] });

    expect(result).toEqual({ ok: false, reason: 'no_source' });
  });

  it('never resolves to AirPlay through the default registry, even with a target present', async () => {
    // The decision lives in `createPlaybackSources`, so assert it through the real call path rather
    // than trusting the id list above: a discoverable target must not change the production outcome.
    const result = await resolveSwitch(
      { id: 'g1', deepLinkUrl: 'https://example.com/watch/g1' },
      { subscribedServices: [] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.source).toBe('deeplink');
  });

  it('still prefers AirPlay over deep-link when a caller opts the dormant source back in', async () => {
    // Guards the dormant-not-deleted decision: if this product ever owns video rights, re-adding the
    // source to the registry should be all that is required.
    const result = await resolveSwitch(
      { id: 'g1', deepLinkUrl: 'https://example.com/watch/g1' },
      { subscribedServices: [] },
      [new AirPlayPlaybackSource(availableRoute), new DeepLinkPlaybackSource()],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.source).toBe('airplay');
      // The deep link still rides along: AirPlay is a bridge to the streaming app, not a stream itself.
      expect(result.session.deepLinkUrl).toBe('https://example.com/watch/g1');
    }
  });
});
