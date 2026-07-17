import {
  AirPlayPlaybackSource,
  ChromecastPlaybackSource,
  DeepLinkPlaybackSource,
  resolvePlaybackSource,
  type Game,
  type PlaybackSource,
  type UserContext,
  type VideoSession,
} from '../playback/PlaybackSource';

/**
 * The v1 playback registry, in priority order (PLAN.md Section 2 / Section 8: phone-as-remote is the
 * primary mode with deep-link as fallback). AirPlay and Chromecast come first so they win once
 * Sprint 8 implements them; today they're `canPlay: false` stubs, so `DeepLinkPlaybackSource` is the
 * only source that ever resolves. Constructed fresh per call — the sources are stateless.
 */
export function createPlaybackSources(): PlaybackSource[] {
  return [new AirPlayPlaybackSource(), new ChromecastPlaybackSource(), new DeepLinkPlaybackSource()];
}

export type SwitchResolution =
  | { ok: true; session: VideoSession }
  | { ok: false; reason: 'no_source' };

/**
 * Resolves how to play a game (Sprint 7 Phase 6): picks the first eligible `PlaybackSource` in
 * priority order and creates its `VideoSession`. Pure aside from the source's own `createSession`
 * (deep-link only builds an object). Returns `{ ok: false }` when nothing can play — e.g. no deep
 * link was resolved for this game — so the caller can render the Section 10 deep-link error state
 * rather than throw.
 */
export async function resolveSwitch(
  game: Game,
  userContext: UserContext,
  sources: PlaybackSource[] = createPlaybackSources(),
): Promise<SwitchResolution> {
  const source = resolvePlaybackSource(sources, game, userContext);
  if (!source) return { ok: false, reason: 'no_source' };
  const session = await source.createSession(game);
  return { ok: true, session };
}
