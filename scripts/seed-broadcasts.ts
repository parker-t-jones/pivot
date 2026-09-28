/**
 * Seeds `public.game_airings` from a real ESPN scoreboard (docs/B1-BROADCAST-DESIGN.md §6): saved
 * JSON (default `experiments/logs/espn-scoreboard-2026-week3.json`) or `--live` for the current
 * week. Airings go through the same `parseEspnAirings` as production and join to `games` on
 * `sportradar_id = 'seed:espn:' || event.id`.
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
  parseEspnAirings,
  type AiringMarket,
  type AiringNetwork,
  type EspnBroadcastEvent,
  type UnmappedMediaLog,
} from '@pivot/shared';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SCOREBOARD_PATH = path.resolve(
  scriptsDir,
  '../experiments/logs/espn-scoreboard-2026-week3.json',
);
export const ESPN_LIVE_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

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

/** `games.sportradar_id` written by `seed:schedule` for an ESPN event. */
export function espnGameExternalId(eventId: string): string {
  return `seed:espn:${eventId}`;
}

export type AiringSource = 'espn_scoreboard' | 'espn_scoreboard_fixture';

/** §1.2: a saved payload is a fixture; `--live` is a real scoreboard read. */
export function airingSourceFor(source: ScoreboardSource): AiringSource {
  return source.kind === 'live' ? 'espn_scoreboard' : 'espn_scoreboard_fixture';
}

export interface AiringSeedRow {
  game_id: string;
  network: AiringNetwork;
  market: AiringMarket;
  source: AiringSource;
  espn_media_name: string;
  espn_type: string | null;
  fetched_at: string;
}

export interface AiringRowsResult {
  /** Candidate rows per matched game, one per `(network, market)`; a game with no airings maps to `[]`. */
  rowsByGame: Map<string, AiringSeedRow[]>;
  /** Scoreboard events with no seeded game. */
  unmatchedEventIds: string[];
}

/** §3.4 step 1: each matched event's geos → candidate `game_airings` rows. */
export function buildAiringRows(
  events: readonly EspnBroadcastEvent[],
  gameIdByExternalId: ReadonlyMap<string, string>,
  source: AiringSource,
  fetchedAt: string,
  logUnmapped: UnmappedMediaLog,
): AiringRowsResult {
  const rowsByGame = new Map<string, AiringSeedRow[]>();
  const unmatchedEventIds: string[] = [];

  for (const event of events) {
    const gameId = gameIdByExternalId.get(espnGameExternalId(event.id));
    if (gameId === undefined) {
      unmatchedEventIds.push(event.id);
      continue;
    }
    const rows = rowsByGame.get(gameId) ?? [];
    const seen = new Set(rows.map((row) => `${row.network}|${row.market}`));
    for (const airing of parseEspnAirings(event, logUnmapped)) {
      const key = `${airing.network}|${airing.market}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        game_id: gameId,
        network: airing.network,
        market: airing.market,
        source,
        espn_media_name: airing.espnMediaName,
        espn_type: airing.espnType,
        fetched_at: fetchedAt,
      });
    }
    rowsByGame.set(gameId, rows);
  }

  return { rowsByGame, unmatchedEventIds };
}

export interface StoredAiringKey {
  id: string;
  network: string;
  market: string;
}

/** The `game_airings` writes §3.4 needs, behind an interface so the per-game logic is testable. */
export interface GameAiringsStore {
  /** `INSERT … ON CONFLICT (game_id, network, market) DO UPDATE`. */
  upsert(rows: readonly AiringSeedRow[]): Promise<void>;
  listForGame(gameId: string): Promise<StoredAiringKey[]>;
  deleteByIds(ids: readonly string[]): Promise<void>;
}

/**
 * §3.4 for one game: upsert the candidates, then delete that game's rows whose `(network, market)`
 * is not a candidate (a FOX→NBC flex drops FOX). Upsert runs first so readers never see the game
 * with no airings. Never touches another game's rows.
 */
export async function writeGameAirings(
  store: GameAiringsStore,
  gameId: string,
  rows: readonly AiringSeedRow[],
): Promise<{ upserted: number; deleted: number }> {
  if (rows.some((row) => row.game_id !== gameId)) {
    throw new Error(`writeGameAirings: every row must belong to game ${gameId}`);
  }
  if (rows.length > 0) await store.upsert(rows);
  const candidates = new Set(rows.map((row) => `${row.network}|${row.market}`));
  const staleIds = (await store.listForGame(gameId))
    .filter((row) => !candidates.has(`${row.network}|${row.market}`))
    .map((row) => row.id);
  if (staleIds.length > 0) await store.deleteByIds(staleIds);
  return { upserted: rows.length, deleted: staleIds.length };
}

function supabaseGameAiringsStore(supabase: SupabaseClient): GameAiringsStore {
  return {
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

interface ScoreboardBody {
  events?: EspnBroadcastEvent[];
}

async function loadScoreboardEvents(source: ScoreboardSource): Promise<EspnBroadcastEvent[]> {
  let body: ScoreboardBody;
  if (source.kind === 'live') {
    console.log(`Fetching live scoreboard from ${ESPN_LIVE_SCOREBOARD_URL}...`);
    const response = await fetch(ESPN_LIVE_SCOREBOARD_URL);
    if (!response.ok) {
      throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
    }
    body = (await response.json()) as ScoreboardBody;
  } else {
    console.log(`Reading scoreboard from ${source.path}...`);
    body = JSON.parse(readFileSync(source.path, 'utf8')) as ScoreboardBody;
  }
  const events = body.events ?? [];
  if (events.length === 0) {
    throw new Error('Scoreboard has no events.');
  }
  return events;
}

export async function seedBroadcasts(source: ScoreboardSource): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.');
  }

  const events = await loadScoreboardEvents(source);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const externalIds = events.map((event) => espnGameExternalId(event.id));
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('id, sportradar_id')
    .in('sportradar_id', externalIds);
  if (gamesError) throw gamesError;
  const gameIdByExternalId = new Map<string, string>(
    (games ?? []).map((game: { id: string; sportradar_id: string }) => [game.sportradar_id, game.id]),
  );
  if (gameIdByExternalId.size === 0) {
    throw new Error('No scoreboard events match seeded games. Run `pnpm seed:schedule` first.');
  }

  const { rowsByGame, unmatchedEventIds } = buildAiringRows(
    events,
    gameIdByExternalId,
    airingSourceFor(source),
    new Date().toISOString(),
    (info) => {
      console.warn(
        `unmapped media "${info.rawName}" on ${info.shortName ?? '?'} (${info.eventId}) via ${info.source} — skipped`,
      );
    },
  );
  for (const eventId of unmatchedEventIds) {
    console.warn(`no seeded game for ESPN event ${eventId} (${espnGameExternalId(eventId)}) — skipped`);
  }

  const store = supabaseGameAiringsStore(supabase);
  let upserted = 0;
  let deleted = 0;
  for (const [gameId, airingRows] of rowsByGame) {
    const result = await writeGameAirings(store, gameId, airingRows);
    upserted += result.upserted;
    deleted += result.deleted;
  }
  console.log(`game_airings: upserted ${upserted}, deleted ${deleted} stale across ${rowsByGame.size} games.`);

  console.log(`Done. ${unmatchedEventIds.length} unmatched events.`);
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
