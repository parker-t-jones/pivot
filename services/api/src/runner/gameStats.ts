import { parseEspnPlayerStats, type EspnSummary } from '@pivot/ingestion';
import type { GamePlayerStats, GameState } from '@pivot/shared';
import {
  translateStatsTeams,
  writeGamePlayerStats,
  type GamePlayerStatsWriter,
} from '../lib/gamePlayerStats.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { settleGamePicks } from './settlePicks.js';

export interface GameStatsRecorderDeps {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  abbrToUuid: ReadonlyMap<string, string>;
  redis: GamePlayerStatsWriter;
  supabase: SupabaseServiceClient;
  getGameState: (gameId: string) => Promise<GameState | null>;
  now?: () => Date;
}

export interface GameStatsRecorder {
  /** Latest parsed summary, for the bet pass on the plays from that same poll. */
  latest(): GamePlayerStats | undefined;
  /** `EspnPlaySource.onSummary`: parse, publish to Redis, and settle once the game is final. */
  record(summary: EspnSummary, receivedAt: number): Promise<void>;
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A final game with no Redis state still settles: teams come from the `games` row. */
function fallbackState(deps: GameStatsRecorderDeps, receivedAt: number): GameState {
  return {
    gameId: deps.gameId,
    homeTeamId: deps.homeTeamId,
    awayTeamId: deps.awayTeamId,
    possessionTeamId: null,
    unitOnField: 'none',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 4,
    timeRemainingSec: 0,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'final',
    updatedAt: receivedAt,
  };
}

/**
 * One per followed game. A Redis failure is logged and the in-memory copy still feeds the bet
 * pass. Settlement runs on the first final summary and again only if it failed.
 */
export function createGameStatsRecorder(deps: GameStatsRecorderDeps): GameStatsRecorder {
  let latest: GamePlayerStats | undefined;
  let settled = false;
  return {
    latest: () => latest,
    async record(summary, receivedAt) {
      const stats = translateStatsTeams(
        parseEspnPlayerStats(summary, deps.gameId, receivedAt),
        deps.abbrToUuid,
      );
      latest = stats;
      try {
        await writeGamePlayerStats(deps.redis, stats);
      } catch (error) {
        console.error(`[runner] player stats write failed ${deps.gameId}: ${failureReason(error)}`);
      }
      if (!stats.final || settled) return;
      try {
        const game = (await deps.getGameState(deps.gameId)) ?? fallbackState(deps, receivedAt);
        const result = await settleGamePicks(
          deps.supabase,
          game,
          stats,
          deps.now ? deps.now() : new Date(),
        );
        settled = true;
        console.log(`[runner] settled ${deps.gameId} picks=${result.picks} slips=${result.slips}`);
      } catch (error) {
        console.error(`[runner] settlement failed ${deps.gameId}: ${failureReason(error)}`);
      }
    },
  };
}
