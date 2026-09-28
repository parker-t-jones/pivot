/**
 * Seeds `public.game_airings` from a real ESPN scoreboard (docs/B1-BROADCAST-DESIGN.md §6): saved
 * JSON (default `experiments/logs/espn-scoreboard-2026-week3.json`) or `--live` for the current
 * week. Both run `ingestAirings` (B1.6), the same function the runner's airings cycle calls, which
 * joins to `games` on `sportradar_id = 'seed:espn:' || event.id`.
 *
 * Idempotent: §3.4's per-game upsert plus stale-row delete.
 *
 * Usage (repo root):
 *   pnpm seed:broadcasts                     # saved Week 3 scoreboard
 *   pnpm seed:broadcasts -- path/to/scoreboard.json
 *   pnpm seed:broadcasts -- --live           # fetch ESPN's current week
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  espnClient,
  ingestAirings,
  type AiringSource,
  type EspnClient,
  type EspnScoreboard,
  type GameAiringsStore,
  type StoredAiringKey,
} from '@pivot/ingestion';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCOREBOARD_PATH = path.resolve(
  scriptsDir,
  '../experiments/logs/espn-scoreboard-2026-week3.json',
);

export type ScoreboardSource = { kind: 'file'; path: string } | { kind: 'live' };

/** Positional scoreboard path or `--live` (remote-safety flags are already stripped). */
export function parseScoreboardSource(rest: readonly string[]): ScoreboardSource {
  let live = false;
  let file: string | undefined;
  for (const arg of rest) {
    if (arg === '--live') {
      live = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`seed:broadcasts: unknown flag ${arg}`);
    }
    if (file !== undefined) {
      throw new Error('seed:broadcasts: pass at most one scoreboard path.');
    }
    file = arg;
  }
  if (live && file !== undefined) {
    throw new Error('seed:broadcasts: --live and a scoreboard path are mutually exclusive.');
  }
  return live ? { kind: 'live' } : { kind: 'file', path: path.resolve(file ?? DEFAULT_SCOREBOARD_PATH) };
}

/** §1.2: a saved payload is a fixture; `--live` is a real scoreboard read. */
export function airingSourceFor(source: ScoreboardSource): AiringSource {
  return source.kind === 'live' ? 'espn_scoreboard' : 'espn_scoreboard_fixture';
}

/** A saved scoreboard served through the same interface as `espnClient`. */
function fileScoreboard(filePath: string): Pick<EspnClient, 'getScoreboard'> {
  return {
    getScoreboard: () =>
      Promise.resolve({
        ok: true as const,
        data: JSON.parse(readFileSync(filePath, 'utf8')) as EspnScoreboard,
      }),
  };
}

function supabaseGameAiringsStore(supabase: SupabaseClient): GameAiringsStore {
  return {
    async gameIdsByExternalId(externalIds) {
      const { data, error } = await supabase
        .from('games')
        .select('id, sportradar_id')
        .in('sportradar_id', [...externalIds]);
      if (error) throw error;
      return new Map(
        (data ?? []).map((game: { id: string; sportradar_id: string }) => [game.sportradar_id, game.id]),
      );
    },
    async upsert(rows) {
      const { error } = await supabase
        .from('game_airings')
        .upsert([...rows], { onConflict: 'game_id,network,market' });
      if (error) throw error;
    },
    async listForGame(gameId) {
      const { data, error } = await supabase
        .from('game_airings')
        .select('id, network, market')
        .eq('game_id', gameId);
      if (error) throw error;
      return (data ?? []) as StoredAiringKey[];
    },
    async deleteByIds(ids) {
      const { error } = await supabase.from('game_airings').delete().in('id', [...ids]);
      if (error) throw error;
    },
  };
}

export async function seedBroadcasts(source: ScoreboardSource): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.');
  }

  console.log(
    source.kind === 'live' ? 'Fetching the current ESPN scoreboard...' : `Reading scoreboard from ${source.path}...`,
  );
  const result = await ingestAirings({
    scoreboard: source.kind === 'live' ? espnClient : fileScoreboard(source.path),
    store: supabaseGameAiringsStore(createClient(supabaseUrl, serviceRoleKey)),
    source: airingSourceFor(source),
    log: (line) => console.warn(line),
  });

  if (result.events === 0) {
    throw new Error('Scoreboard has no events.');
  }
  if (result.games === 0) {
    throw new Error('No scoreboard events match seeded games. Run `pnpm seed:schedule` first.');
  }
  console.log(
    `game_airings: upserted ${result.rows}, deleted ${result.deleted} stale across ${result.games} games.`,
  );
  console.log(`Done. ${result.unmapped} unmapped, ${result.unmatchedEventIds.length} unmatched events.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const cli = bootstrapSeedScript({
      argv: process.argv.slice(2),
      scriptName: 'seed:broadcasts',
      forbidRemoteAlways: true,
    });
    seedBroadcasts(parseScoreboardSource(cli.rest)).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof RemoteSafetyError ? error.exitCode : 1;
  }
}
