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
]);

export function mapMediaName(name: string): AiringNetwork | null {
  return MEDIA_NAME_TO_NETWORK.get(name) ?? null;
}
