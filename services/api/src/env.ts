import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ quiet: true });

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  // Phase 4 / sprint decision #1: the `/v1/realtime` fan-out subscriber needs a persistent TCP
  // connection (`ioredis`) — the REST client above can't hold a `(P)SUBSCRIBE`.
  UPSTASH_REDIS_TCP_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadAndValidateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.message}`);
  }
  if (parsed.data.CACHE_DRIVER === 'redis') {
    if (
      !parsed.data.UPSTASH_REDIS_REST_URL ||
      !parsed.data.UPSTASH_REDIS_REST_TOKEN ||
      !parsed.data.UPSTASH_REDIS_TCP_URL
    ) {
      throw new Error(
        'CACHE_DRIVER=redis requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, and UPSTASH_REDIS_TCP_URL.',
      );
    }
  }
  return parsed.data;
}

export const env = loadAndValidateEnv();
