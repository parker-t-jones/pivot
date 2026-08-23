import { Redis } from '@upstash/redis';
import { InMemoryGameStateStore } from './inMemoryGameStateStore.js';
import { RedisGameStateProvider } from './redisGameStateProvider.js';
import type { GameStateStore } from './gameStateStore.js';

/**
 * Minimal config the provider factory needs. Passed explicitly (rather than importing an `env`
 * module) so `@pivot/dispatcher` stays free of any `@pivot/api` dependency — the
 * dependency runs the other way (sprint decision #9). The API/dispatcher entrypoints build this from
 * their own validated env.
 */
export interface RedisProviderConfig {
  cacheDriver: 'memory' | 'redis';
  upstashRestUrl?: string | undefined;
  upstashRestToken?: string | undefined;
}

/** Mirrors `createLineupCacheProvider` (Sprint 3): `CACHE_DRIVER` selects the implementation at boot. */
export function createGameStateStore(config: RedisProviderConfig): GameStateStore {
  if (config.cacheDriver === 'redis') {
    if (!config.upstashRestUrl || !config.upstashRestToken) {
      throw new Error(
        'CACHE_DRIVER=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
      );
    }
    return new RedisGameStateProvider(
      new Redis({ url: config.upstashRestUrl, token: config.upstashRestToken }),
    );
  }
  return new InMemoryGameStateStore();
}

export type { GameStateStore } from './gameStateStore.js';
export { InMemoryGameStateStore } from './inMemoryGameStateStore.js';
export { RedisGameStateProvider } from './redisGameStateProvider.js';
