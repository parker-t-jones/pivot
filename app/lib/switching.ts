import {
  DeepLinkPlaybackSource,
  resolvePlaybackSource,
  type Game,
  type PlaybackSource,
  type UserContext,
  type VideoSession,
} from '../playback/PlaybackSource';

/**
 * The v1 playback registry, in priority order — deep-link only.
 *
 * Sprint 8 planned cast-first priority (AirPlay, then Chromecast, then deep-link). Sprint 10 Track B
 * established on hardware that neither can route a *third-party* streaming app's video to a TV, because
 * v1 owns no video rights and so has no player of its own to route (PLAN.md Section 11, "AirPlay and
 * Chromecast (not achievable as scoped)"). Both are therefore left out of this array rather than
 * deleted: `AirPlayPlaybackSource` stays implemented and tested so it becomes useful immediately if
 * this product ever owns or licenses video. Constructed fresh per call — the sources are stateless.
 */
export function createPlaybackSources(): PlaybackSource[] {
  return [new DeepLinkPlaybackSource()];
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
