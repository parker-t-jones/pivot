/**
 * Local dev must not take `pivot:runner:leader` on the production Upstash host.
 * The repo has no `REDIS_URL`. Callers pass `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_TCP_URL`,
 * and `REDIS_URL` when that name is set. `PRODUCTION_REDIS_HOST` is the hostname only.
 */

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A reason to exit, or null when this process may connect. */
export function productionRedisRefusal(input: {
  urls: readonly (string | undefined)[];
  productionHost: string | undefined;
  nodeEnv: string | undefined;
}): string | null {
  if (input.nodeEnv === 'production') return null;
  const host = input.productionHost?.trim().toLowerCase();
  if (host === undefined || host.length === 0) return null;
  for (const url of input.urls) {
    if (url === undefined || url.length === 0) continue;
    const parsed = hostnameOf(url);
    if (parsed !== null && parsed === host) {
      return `refusing to start: Redis host ${parsed} matches PRODUCTION_REDIS_HOST while NODE_ENV is not production`;
    }
  }
  return null;
}

export function guardRunnerStart(input: {
  cacheDriver: string;
  nodeEnv: string | undefined;
  productionHost: string | undefined;
  redisUrls: readonly (string | undefined)[];
}): string | null {
  if (input.cacheDriver !== 'redis') {
    return 'CACHE_DRIVER=redis is required';
  }
  return productionRedisRefusal({
    urls: input.redisUrls,
    productionHost: input.productionHost,
    nodeEnv: input.nodeEnv,
  });
}

/**
 * Exits before any Redis command. `openRedis` is the first point that could `SET NX`.
 */
export async function startGuarded<T>(
  input: {
    cacheDriver: string;
    nodeEnv: string | undefined;
    productionHost: string | undefined;
    redisUrls: readonly (string | undefined)[];
    exit: (code: number) => void;
    log?: (line: string) => void;
    openRedis: () => T;
  },
  run: (redis: T) => Promise<void>,
): Promise<void> {
  const blocked = guardRunnerStart(input);
  if (blocked !== null) {
    (input.log ?? console.error)(`[runner] ${blocked}`);
    input.exit(1);
    return;
  }
  await run(input.openRedis());
}
