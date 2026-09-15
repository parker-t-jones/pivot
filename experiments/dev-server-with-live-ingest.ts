/**
 * Runs the REAL `@pivot/api` Fastify server AND live ESPN ingestion in ONE process, so both share
 * the exact same in-memory `GameStateStore` instance — closing the gap documented in
 * `services/engine/src/applyPlayToState.ts`'s remark (ESPN plays are never translated + written
 * into the store `GET /games/live` reads from) WITHOUT needing Redis/Upstash TCP credentials we
 * don't have on hand tonight (Sept 14, 2026).
 *
 * This *replaces* `pnpm --filter @pivot/api dev` while it's running — same port, same routes, same
 * env (`services/api/.env`, `CACHE_DRIVER=memory` is fine and expected here). Kill the normal API
 * dev server first, then run this instead:
 *
 *   npx tsx experiments/dev-server-with-live-ingest.ts --espn-id 401872931
 *   npx tsx experiments/dev-server-with-live-ingest.ts --espn-id 401872931,401872930
 *
 * Once this test is over, go back to the normal `pnpm --filter @pivot/api dev` — this script is a
 * stopgap, not the permanent fix. The permanent fix is a real standing `services/ingestion` process
 * writing into a shared Redis-backed store (this script's sibling `live-ingest-service.ts` is the
 * shape of that, minus the TCP credential it needs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { GameStateStore } from '@pivot/dispatcher';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runOne } from './liveIngestCore.js';

// Must run BEFORE the dynamic `services/api/src/env.js` import below — that module validates
// `process.env` at import time, and (unlike `pnpm --filter @pivot/api dev`) our cwd here is the
// repo root, not `services/api/`, so its own default `dotenv.config()` wouldn't find the file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

/** Minimal structural shape of the built Fastify instance we actually touch — deliberately not
 *  importing `fastify`'s types (not a dependency here) or `services/api/src/server.ts` statically
 *  (outside this package's tsconfig `rootDir`, same reason `verify-push-payload.ts` dynamic-imports
 *  instead of a static import). Loaded via a non-literal specifier below so TS can't try to infer
 *  the module's real type and pull its whole source tree into this program. */
interface DevServerInstance {
  listen(opts: { port: number; host: string }): Promise<string>;
  gameStateStore: GameStateStore;
  supabase: SupabaseClient;
}

function parseArgs(): { espnIds: string[] } {
  const args = process.argv.slice(2);
  const idsArg = args.find((a) => a.startsWith('--espn-id='))?.split('=')[1];
  const idsFlagIndex = args.indexOf('--espn-id');
  const idsFlagValue = idsFlagIndex >= 0 ? args[idsFlagIndex + 1] : undefined;
  const raw = idsArg ?? idsFlagValue;
  if (!raw) {
    console.error(
      'Usage: npx tsx experiments/dev-server-with-live-ingest.ts --espn-id 401872931[,...]',
    );
    process.exit(1);
  }
  return { espnIds: raw.split(',').map((s) => s.trim()).filter(Boolean) };
}

async function main(): Promise<void> {
  const { espnIds } = parseArgs();

  // Non-literal specifiers so TS resolves these as plain dynamic imports (typed `any`) rather than
  // trying to load `services/api/src/*`'s real declarations into this program (see interface above).
  const serverModulePath = '../services/api/src/server.js';
  const envModulePath = '../services/api/src/env.js';
  const { buildServer } = (await import(serverModulePath)) as {
    buildServer: (env: unknown) => Promise<DevServerInstance>;
  };
  const { env } = (await import(envModulePath)) as { env: { PORT: number } };

  const fastify = await buildServer(env);
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`[dev-server-with-live-ingest] API server listening on :${env.PORT}`);

  console.log(`[dev-server-with-live-ingest] starting live ingestion for: ${espnIds.join(', ')}`);
  void Promise.all(
    espnIds.map((id) => runOne(fastify.supabase, fastify.gameStateStore, id)),
  ).then(() => {
    console.log('[dev-server-with-live-ingest] all ingestion subscriptions ended');
  });
}

main().catch((error) => {
  console.error('[dev-server-with-live-ingest] fatal error', error);
  process.exit(1);
});
