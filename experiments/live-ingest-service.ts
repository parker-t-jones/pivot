/**
 * Live game-state ingestion runner (temporary — sibling of `live-sunday-harness.ts`).
 *
 * STANDALONE / Redis-backed variant. Requires `services/api/.env` to have `CACHE_DRIVER=redis`
 * *and* `UPSTASH_REDIS_TCP_URL` set (Upstash dashboard → Redis → "Connect" → TCP/ioredis string),
 * with the API server restarted after that change, so this script and the API server share the
 * same Redis-backed `GameStateStore`.
 *
 * Don't have the TCP url yet? Use `dev-server-with-live-ingest.ts` instead — it runs the real API
 * server and this same ingestion logic in ONE process, sharing the in-memory store directly, no
 * Redis required. That's the one used for the Sept 14, 2026 live test.
 *
 * Usage:
 *   npx tsx experiments/live-ingest-service.ts --espn-id 401872931
 *   npx tsx experiments/live-ingest-service.ts --espn-id 401872931,401872930   (multiple games)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createGameStateStore } from '@pivot/dispatcher';
import { makeSupabase, runOne } from './liveIngestCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
const CACHE_DRIVER = (process.env['CACHE_DRIVER'] ?? 'memory') as 'memory' | 'redis';
const UPSTASH_REDIS_REST_URL = process.env['UPSTASH_REDIS_REST_URL'];
const UPSTASH_REDIS_REST_TOKEN = process.env['UPSTASH_REDIS_REST_TOKEN'];

function parseArgs(): { espnIds: string[] } {
  const args = process.argv.slice(2);
  const idsArg = args.find((a) => a.startsWith('--espn-id='))?.split('=')[1];
  const idsFlagIndex = args.indexOf('--espn-id');
  const idsFlagValue = idsFlagIndex >= 0 ? args[idsFlagIndex + 1] : undefined;
  const raw = idsArg ?? idsFlagValue;
  if (!raw) {
    console.error('Usage: npx tsx experiments/live-ingest-service.ts --espn-id 401872931[,...]');
    process.exit(1);
  }
  return { espnIds: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

async function main(): Promise<void> {
  const { espnIds } = parseArgs();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (expected in services/api/.env)');
    process.exit(1);
  }
  if (CACHE_DRIVER !== 'redis') {
    console.warn(
      '[live-ingest] WARNING: CACHE_DRIVER is not "redis" in services/api/.env — this script will ' +
        'write to its OWN private in-memory store, invisible to the API server. GET /games/live will ' +
        'stay empty. Use dev-server-with-live-ingest.ts instead, or set CACHE_DRIVER=redis (+ TCP url) ' +
        'and restart the API server first.',
    );
  }

  const supabase = makeSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const gameStateStore = createGameStateStore({
    cacheDriver: CACHE_DRIVER,
    upstashRestUrl: UPSTASH_REDIS_REST_URL,
    upstashRestToken: UPSTASH_REDIS_REST_TOKEN,
  });

  console.log(
    `[live-ingest] starting for ESPN game(s): ${espnIds.join(', ')} (cacheDriver=${CACHE_DRIVER})`,
  );

  await Promise.all(espnIds.map((id) => runOne(supabase, gameStateStore, id)));

  console.log('[live-ingest] all subscriptions ended, exiting');
}

main().catch((error) => {
  console.error('[live-ingest] fatal error', error);
  process.exit(1);
});
