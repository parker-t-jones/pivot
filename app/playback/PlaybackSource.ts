/**
 * Swap-ready playback boundary (PLAN.md Section 2, "Swap-ready architecture principle"). Follows the
 * same pattern as `FantasyProvider` (services/api/src/providers/fantasy-provider.ts) and
 * `PushNotifier` (services/dispatcher/src/pushNotifier.ts): one interface with a discriminant `id`
 * whose enum already carries a value (`'embedded'`) ahead of its implementation, so a future source
 * (Phase 2's `EmbeddedStreamPlaybackSource`, Section 15) is a local addition rather than an interface
 * change. `pushNotifier.ts`'s own header cites this enum as the precedent for that convention.
 *
 * v1 (Section 4): `DeepLinkPlaybackSource` ships in Sprint 7. `AirPlayPlaybackSource` and
 * `ChromecastPlaybackSource` are Sprint 8 (Section 11) and ship here as `canPlay: false` stubs so the
 * `resolvePlaybackSource` registry pattern is provable now without pretending Sprint 8 is done.
 */

/** Phase 1 placeholder — minimal game shape for playback resolution, not yet reconciled with `GameState`
 *  (shared/src/engine/types.ts) or `GameSummary` (app/lib/flagEventPayload.ts); likely promoted to `shared/` later. */
export interface Game {
  id: string;
  /** Resolved deep link for this user+game; populated by `BroadcastResolver` (a later Sprint 7 phase). */
  deepLinkUrl?: string;
}

/** Phase 1 placeholder — minimal user context for playback resolution, not yet reconciled with any shared
 *  type; likely promoted to `shared/` later. Sprint 8 sources (AirPlay/Chromecast) will read more from it. */
export interface UserContext {
  subscribedServices: string[];
}

export interface VideoSession {
  source: PlaybackSource['id'];
  gameId: string;
  deepLinkUrl?: string;
  startedAt: string;
}

export interface PlaybackSource {
  id: 'deeplink' | 'airplay' | 'chromecast' | 'embedded';
  canPlay(game: Game, userContext: UserContext): boolean;
  createSession(game: Game): Promise<VideoSession>;
}

/**
 * Aggregator/deep-link mode (Section 2, v1 fallback). Playable whenever the game carries a resolved
 * deep link for this user — the URL itself comes from `BroadcastResolver` in a later phase; this
 * source only cares that one is present.
 */
export class DeepLinkPlaybackSource implements PlaybackSource {
  readonly id = 'deeplink' as const;

  canPlay(game: Game, _userContext: UserContext): boolean {
    return typeof game.deepLinkUrl === 'string' && game.deepLinkUrl.length > 0;
  }

  async createSession(game: Game): Promise<VideoSession> {
    if (!game.deepLinkUrl) {
      throw new Error(`DeepLinkPlaybackSource cannot play game "${game.id}": no deep link resolved.`);
    }
    return {
      source: this.id,
      gameId: game.id,
      deepLinkUrl: game.deepLinkUrl,
      startedAt: new Date().toISOString(),
    };
  }
}

/** Sprint 8 (Section 11) — real AirPlay via native iOS APIs. Stubbed as `canPlay: false` this phase so
 *  the registry pattern is provable without faking Sprint 8's work. */
export class AirPlayPlaybackSource implements PlaybackSource {
  readonly id = 'airplay' as const;

  canPlay(_game: Game, _userContext: UserContext): boolean {
    return false;
  }

  async createSession(_game: Game): Promise<VideoSession> {
    throw new Error('AirPlayPlaybackSource is not implemented until Sprint 8.');
  }
}

/** Sprint 8 (Section 11) — real Chromecast via react-native-google-cast. Stubbed as `canPlay: false`
 *  this phase so the registry pattern is provable without faking Sprint 8's work. */
export class ChromecastPlaybackSource implements PlaybackSource {
  readonly id = 'chromecast' as const;

  canPlay(_game: Game, _userContext: UserContext): boolean {
    return false;
  }

  async createSession(_game: Game): Promise<VideoSession> {
    throw new Error('ChromecastPlaybackSource is not implemented until Sprint 8.');
  }
}

/**
 * Pure registry resolver: returns the first source in the supplied priority order whose `canPlay` is
 * true, or `null` if none can play. Priority is caller-supplied array order — composing the actual
 * registry (Section 8 implies cast-primary, deep-link fallback) is a later phase.
 */
export function resolvePlaybackSource(
  sources: PlaybackSource[],
  game: Game,
  userContext: UserContext,
): PlaybackSource | null {
  return sources.find((source) => source.canPlay(game, userContext)) ?? null;
}
