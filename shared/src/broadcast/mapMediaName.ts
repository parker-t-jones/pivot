import type { AiringNetwork } from './types.js';

/**
 * ESPN media.shortName / broadcasts[].names[] → airing network (§3.3).
 * Exact table only — no aliases. Unknown → null.
 */
const MEDIA_NAME_TO_NETWORK: ReadonlyMap<string, AiringNetwork> = new Map([
  ['CBS', 'cbs'],
  ['FOX', 'fox'],
  ['NBC', 'nbc'],
  ['ABC', 'abc'],
  ['ESPN', 'espn'],
  ['Prime Video', 'amazon_prime'],
  // ESPN shortName on the 2026-10-04 London game. Not an alias for "NFL Network" or "NFLN".
  ['NFL Net', 'nfl_network'],
]);

export function mapMediaName(name: string): AiringNetwork | null {
  return MEDIA_NAME_TO_NETWORK.get(name) ?? null;
}
