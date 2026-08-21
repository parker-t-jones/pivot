import { describe, expect, it } from 'vitest';

import type { AirPlayRouteController } from './airPlayRoute';
import {
  AirPlayPlaybackSource,
  ChromecastPlaybackSource,
  DeepLinkPlaybackSource,
  resolvePlaybackSource,
  type Game,
  type PlaybackSource,
  type UserContext,
  type VideoSession,
} from './PlaybackSource';

const userContext: UserContext = { subscribedServices: [] };
const gameWithLink: Game = { id: 'game-1', deepLinkUrl: 'https://example.com/watch/game-1' };
const gameWithoutLink: Game = { id: 'game-2' };

/** Stands in for the native AirPlay boundary so `AirPlayPlaybackSource` is testable off-device, and
 *  counts picker presentations — the one side effect `createSession` has. */
function fakeRoute({ available }: { available: boolean }): AirPlayRouteController & { presentCount: number } {
  return {
    presentCount: 0,
    isTargetAvailable: () => available,
    activeRouteName: () => (available ? 'Living Room' : null),
    subscribe: () => () => {
      // Availability is fixed per fake, so there is nothing to detach.
    },
    async presentRoutePicker() {
      this.presentCount += 1;
      return available;
    },
  };
}

/** Minimal stand-in so ordering can be tested with more than one *eligible* source (`DeepLinkPlaybackSource`
 *  plus, on device, AirPlay; Chromecast remains `canPlay: false`). */
function fakeSource(id: PlaybackSource['id'], canPlay: boolean): PlaybackSource {
  return {
    id,
    canPlay: () => canPlay,
    createSession: async (game): Promise<VideoSession> => ({
      source: id,
      gameId: game.id,
      startedAt: new Date().toISOString(),
    }),
  };
}

describe('resolvePlaybackSource', () => {
  it('returns the first source in priority order when several can play', () => {
    const first = fakeSource('airplay', true);
    const second = fakeSource('chromecast', true);
    const third = fakeSource('deeplink', true);

    const resolved = resolvePlaybackSource([first, second, third], gameWithLink, userContext);

    expect(resolved).toBe(first);
  });

  it('returns null when no source can play', () => {
    const sources = [
      new AirPlayPlaybackSource(),
      new ChromecastPlaybackSource(),
      new DeepLinkPlaybackSource(),
    ];

    // DeepLink is the only real source, and it can't play a game with no resolved deep link.
    const resolved = resolvePlaybackSource(sources, gameWithoutLink, userContext);

    expect(resolved).toBeNull();
  });

  it('returns the sole source when a single source can play', () => {
    const deepLink = new DeepLinkPlaybackSource();

    const resolved = resolvePlaybackSource([deepLink], gameWithLink, userContext);

    expect(resolved).toBe(deepLink);
  });

  it('skips ineligible sources and returns the one eligible source', () => {
    const airplay = new AirPlayPlaybackSource();
    const chromecast = new ChromecastPlaybackSource();
    const deepLink = new DeepLinkPlaybackSource();

    // AirPlay/Chromecast are `canPlay: false` stubs; only DeepLink is eligible for a linked game.
    const resolved = resolvePlaybackSource([airplay, chromecast, deepLink], gameWithLink, userContext);

    expect(resolved).toBe(deepLink);
  });

  it('returns null for an empty source list', () => {
    expect(resolvePlaybackSource([], gameWithLink, userContext)).toBeNull();
  });
});

describe('DeepLinkPlaybackSource', () => {
  it('can play only when the game carries a resolved deep link', () => {
    const source = new DeepLinkPlaybackSource();

    expect(source.canPlay(gameWithLink, userContext)).toBe(true);
    expect(source.canPlay(gameWithoutLink, userContext)).toBe(false);
  });

  it('creates a video session carrying the deep link', async () => {
    const source = new DeepLinkPlaybackSource();

    const session = await source.createSession(gameWithLink);

    expect(session.source).toBe('deeplink');
    expect(session.gameId).toBe(gameWithLink.id);
    expect(session.deepLinkUrl).toBe(gameWithLink.deepLinkUrl);
    expect(typeof session.startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(session.startedAt))).toBe(false);
  });

  it('refuses to create a session without a resolved deep link', async () => {
    const source = new DeepLinkPlaybackSource();

    await expect(source.createSession(gameWithoutLink)).rejects.toThrow();
  });
});

describe('AirPlayPlaybackSource', () => {
  it('cannot play when no AirPlay target is discoverable', () => {
    const source = new AirPlayPlaybackSource(fakeRoute({ available: false }));

    expect(source.canPlay(gameWithLink, userContext)).toBe(false);
  });

  it('defaults to unavailable when no route controller is injected', () => {
    // Guards the off-device/JS-test path: constructing without a controller must never claim AirPlay.
    expect(new AirPlayPlaybackSource().canPlay(gameWithLink, userContext)).toBe(false);
  });

  it('can play when a target is discoverable and the game has a deep link', () => {
    const source = new AirPlayPlaybackSource(fakeRoute({ available: true }));

    expect(source.canPlay(gameWithLink, userContext)).toBe(true);
  });

  it('cannot play a game with no deep link even with a target present', () => {
    // Bridge model: the deep link is what actually starts playback, so a target alone is not enough.
    const source = new AirPlayPlaybackSource(fakeRoute({ available: true }));

    expect(source.canPlay(gameWithoutLink, userContext)).toBe(false);
  });

  it('presents the route picker and carries the deep link into the session', async () => {
    const route = fakeRoute({ available: true });
    const source = new AirPlayPlaybackSource(route);

    const session = await source.createSession(gameWithLink);

    expect(route.presentCount).toBe(1);
    expect(session.source).toBe('airplay');
    expect(session.gameId).toBe(gameWithLink.id);
    expect(session.deepLinkUrl).toBe(gameWithLink.deepLinkUrl);
    expect(Number.isNaN(Date.parse(session.startedAt))).toBe(false);
  });

  it('refuses to create a session without a deep link, without presenting the picker', async () => {
    const route = fakeRoute({ available: true });
    const source = new AirPlayPlaybackSource(route);

    await expect(source.createSession(gameWithoutLink)).rejects.toThrow();
    expect(route.presentCount).toBe(0);
  });
});

describe('ChromecastPlaybackSource stub', () => {
  it('never claims it can play', () => {
    expect(new ChromecastPlaybackSource().canPlay(gameWithLink, userContext)).toBe(false);
  });
});
