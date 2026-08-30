import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ quiet: true });

/**
 * Mirrors `services/api/src/env.ts`'s dotenv + zod pattern, so `@pivot/shared`'s `initSentry` never
 * reads `process.env` itself (the hard rule: services receive configuration via constructor
 * injection, not globals) — this is the one place in `@pivot/ingestion` that does, and only this
 * module's own entry point should import it.
 */
const envSchema = z.object({
  /** Absent in local dev is expected — `initSentry` no-ops without it. Never hardcode a value here. */
  SENTRY_DSN: z.string().optional(),
  /** Tagged on every Sentry event via `initSentry`'s `environment` option. Scoped to Sentry rather
   *  than a project-wide `NODE_ENV`, since nothing else in the codebase reads one yet. */
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function loadAndValidateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.message}`);
  }
  return parsed.data;
}

export const env = loadAndValidateEnv();
