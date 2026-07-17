import { describe, expect, it } from 'vitest';

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

/** Minimal stand-in so ordering can be tested with more than one *eligible* source (the only real
 *  eligible source this phase is `DeepLinkPlaybackSource`; the Sprint 8 sources are `canPlay: false`). */
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

describe('Sprint 8 source stubs', () => {
  it('never claim they can play in this phase', () => {
    expect(new AirPlayPlaybackSource().canPlay(gameWithLink, userContext)).toBe(false);
    expect(new ChromecastPlaybackSource().canPlay(gameWithLink, userContext)).toBe(false);
  });
});
