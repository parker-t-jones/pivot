/**
 * Same shape as `dev-server-with-live-ingest.ts`, but instead of racing a real (already-final)
 * ESPN game through its whole play-by-play in a few seconds, this pins the shared `GameStateStore`
 * to ONE hand-picked, stable "in progress" snapshot — useful for visually demoing/screenshotting a
 * Home State 2 card (`HomeLiveIdleCard`) without a timing race against how fast the real ESPN
 * replay blasts through an already-completed game.
 *
 *   npx tsx experiments/dev-server-demo-snapshot.ts --espn-id 401872947
 *
 * Kill any other API/harness process on :3000 first (see RUNBOOK.md).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { GameStateStore } from '@pivot/dispatcher';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '@pivot/shared';
import { markStatus, resolveGame } from './liveIngestCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

interface DevServerInstance {
  listen(opts: { port: number; host: string }): Promise<string>;
  gameStateStore: GameStateStore;
  supabase: SupabaseClient;
}

function parseArgs(): { espnId: string } {
  const args = process.argv.slice(2);
  const idsArg = args.find((a) => a.startsWith('--espn-id='))?.split('=')[1];
  const idsFlagIndex = args.indexOf('--espn-id');
  const idsFlagValue = idsFlagIndex >= 0 ? args[idsFlagIndex + 1] : undefined;
  const raw = idsArg ?? idsFlagValue;
  if (!raw) {
    console.error('Usage: npx tsx experiments/dev-server-demo-snapshot.ts --espn-id 401872931');
    process.exit(1);
  }
  return { espnId: raw.trim() };
}

async function main(): Promise<void> {
  const { espnId } = parseArgs();

  const serverModulePath = '../services/api/src/server.js';
  const envModulePath = '../services/api/src/env.js';
  const { buildServer } = (await import(serverModulePath)) as {
    buildServer: (env: unknown) => Promise<DevServerInstance>;
  };
  const { env } = (await import(envModulePath)) as { env: { PORT: number } };

  const fastify = await buildServer(env);
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`[dev-server-demo-snapshot] API server listening on :${env.PORT}`);

  const resolved = await resolveGame(fastify.supabase, espnId);
  if (!resolved) {
    console.error(`[dev-server-demo-snapshot] no seeded game found for ESPN id ${espnId}`);
    process.exit(1);
  }
  const { internalGameId, abbrToUuid } = resolved;
  const teamIds = [...abbrToUuid.values()];
  const [homeTeamId, awayTeamId] = teamIds;
  if (!homeTeamId || !awayTeamId) {
    console.error('[dev-server-demo-snapshot] could not resolve both team ids');
    process.exit(1);
  }

  // Hand-picked "red zone, 2nd & 5, meaningful score" snapshot — stable until this process exits,
  // so there's no race against a poll/refresh cycle to catch it.
  const state: GameState = {
    gameId: internalGameId,
    homeTeamId,
    awayTeamId,
    possessionTeamId: awayTeamId,
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 20,
    quarter: 3,
    timeRemainingSec: 247,
    yardsToOpponentEndzone: 5,
    down: 2,
    distance: 5,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: Date.now(),
  };

  await fastify.gameStateStore.setGameState(internalGameId, state);
  await markStatus(fastify.supabase, internalGameId, 'in_progress');
  console.log(
    `[dev-server-demo-snapshot] pinned ${espnId} (${internalGameId}) to Q3 4:07, ` +
      `${state.scoreAway}-${state.scoreHome}, red zone, 2nd & 5 — will stay put until this process exits.`,
  );
}

main().catch((error) => {
  console.error('[dev-server-demo-snapshot] fatal error', error);
  process.exit(1);
});
