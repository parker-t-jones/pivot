import { Redis as UpstashRedis } from '@upstash/redis';
import type { Redis } from 'ioredis';
import type { Env } from '../env.js';
import { createTcpRedis } from '../runner/tcpRedis.js';
import { InMemoryLineupCache } from './in-memory.js';
import { RedisLineupCache } from './redis.js';
import { TcpLineupCache } from './tcp.js';
import type { LineupCacheProvider } from './types.js';

export function createLineupCacheProvider(env: Env, redis?: Redis): LineupCacheProvider {
  if (env.CACHE_DRIVER === 'redis' && env.REDIS_URL) {
    return new TcpLineupCache(redis ?? createTcpRedis(env.REDIS_URL, 'cache'));
  }
  if (env.CACHE_DRIVER === 'redis') {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        'CACHE_DRIVER=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
      );
    }
    return new RedisLineupCache(
      new UpstashRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    );
  }
  return new InMemoryLineupCache();
}

export type { LineupCacheProvider, NflState } from './types.js';
export { InMemoryLineupCache } from './in-memory.js';
export { RedisLineupCache } from './redis.js';
export { TcpLineupCache } from './tcp.js';
