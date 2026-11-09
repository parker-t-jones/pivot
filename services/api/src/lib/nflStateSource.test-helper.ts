// Test-only NFL-state sources for `getCurrentNflState`. Production passes `sleeperClient`; tests
// pass one of these so a cache miss is answered locally and never reaches Sleeper.
import { vi } from 'vitest';
import type { SleeperNflState } from '../providers/sleeper-client.js';
import type { NflStateSource } from './nfl-state.js';

/** For tests that seed the NFL state in the lineup cache. A cache miss is a test bug (the test
 *  outlived the TTL or forgot to seed), so it fails loudly instead of falling through. */
export const unreachableNflStateSource: NflStateSource = {
  getNflState() {
    return Promise.reject(
      new Error(
        'Test reached the NFL-state source on a cache miss. Seed lineupCache.setNflState or pass fakeNflStateSource.',
      ),
    );
  },
};

/** Answers every cache miss with `state` (defaults: 2026 regular season, week 1). The returned
 *  `getNflState` is a spy, so tests can assert when the cache missed. */
export function fakeNflStateSource(state: Partial<SleeperNflState> = {}) {
  const value: SleeperNflState = {
    season: '2026',
    previous_season: '2025',
    week: 1,
    season_type: 'regular',
    ...state,
  };
  return { getNflState: vi.fn(() => Promise.resolve(value)) } satisfies NflStateSource;
}
