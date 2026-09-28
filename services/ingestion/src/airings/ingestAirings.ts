import {
  parseEspnAirings,
  type AiringMarket,
  type AiringNetwork,
  type EspnBroadcastEvent,
  type UnmappedMediaLog,
} from '@pivot/shared';
import type { EspnClient, EspnScoreboardWeek } from '../espn/espnClient.js';

/** `games.sportradar_id` written by `seed:schedule` for an ESPN event. */
export function espnGameExternalId(eventId: string): string {
  return `seed:espn:${eventId}`;
}

/** §1.2: a saved payload is a fixture; a real scoreboard read is `espn_scoreboard`. */
export type AiringSource = 'espn_scoreboard' | 'espn_scoreboard_fixture';

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

/** The `games` lookup and `game_airings` writes §3.4 needs, behind an interface so ingest is testable. */
export interface GameAiringsStore {
  /** `games.id` keyed by `sportradar_id`, for the ids that exist. */
  gameIdsByExternalId(externalIds: readonly string[]): Promise<Map<string, string>>;
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

export interface IngestAiringsDeps {
  scoreboard: Pick<EspnClient, 'getScoreboard'>;
  store: GameAiringsStore;
  /** Defaults to `espn_scoreboard`; a saved payload passes `espn_scoreboard_fixture`. */
  source?: AiringSource;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface IngestAiringsResult {
  events: number;
  /** Candidate rows upserted across all matched games. */
  rows: number;
  /** Matched games written (a game with no mappable airings still counts; its rows are cleared). */
  games: number;
  /** Stale rows deleted (flex). */
  deleted: number;
  /** Media names that mapped to no network, one per occurrence. */
  unmapped: number;
  /** Scoreboard events with no seeded game; logged and skipped, never created (§3.4). */
  unmatchedEventIds: string[];
}

/**
 * B1.6: one scoreboard (current week without `week`) → mapped airings → §3.4 write per game.
 * Throws when the scoreboard fetch fails; unmapped media names and unmatched events are logged.
 */
export async function ingestAirings(
  deps: IngestAiringsDeps,
  week?: EspnScoreboardWeek,
): Promise<IngestAiringsResult> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  const board = await deps.scoreboard.getScoreboard(week);
  if (!board.ok) throw new Error(`scoreboard failed: ${board.reason}`);
  const events: readonly EspnBroadcastEvent[] = board.data.events ?? [];

  const gameIdByExternalId = await deps.store.gameIdsByExternalId(
    events.map((event) => espnGameExternalId(event.id)),
  );

  let unmapped = 0;
  const { rowsByGame, unmatchedEventIds } = buildAiringRows(
    events,
    gameIdByExternalId,
    deps.source ?? 'espn_scoreboard',
    now().toISOString(),
    (info) => {
      unmapped += 1;
      log(
        `unmapped media "${info.rawName}" on ${info.shortName ?? '?'} (${info.eventId}) via ${info.source} — skipped`,
      );
    },
  );
  for (const eventId of unmatchedEventIds) {
    log(`no seeded game for ESPN event ${eventId} (${espnGameExternalId(eventId)}) — skipped`);
  }

  let rows = 0;
  let deleted = 0;
  for (const [gameId, gameRows] of rowsByGame) {
    const result = await writeGameAirings(deps.store, gameId, gameRows);
    rows += result.upserted;
    deleted += result.deleted;
  }

  return {
    events: events.length,
    rows,
    games: rowsByGame.size,
    deleted,
    unmapped,
    unmatchedEventIds,
  };
}
