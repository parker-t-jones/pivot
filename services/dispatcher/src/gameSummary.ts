import type { GameState } from '@fantasy-focus/shared';
import type { GameSummaryInfo } from './catalogs.js';

/**
 * Section 9's abbreviated game summary shape — shared verbatim between the WebSocket `flag_event`
 * payload (`delivery.ts`) and the REST `/flags/current` cold-start endpoint (Phase 5's `game` field:
 * "the abbreviated game_summary shape used in the WebSocket flag_event payload — reuse the same
 * builder"). One builder means the two response shapes can't silently drift apart.
 */
export interface GameSummary {
  home_team: string;
  away_team: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
}

export function buildGameSummary(
  gameState: GameState | null,
  info: GameSummaryInfo | null,
): GameSummary {
  return {
    home_team: info?.homeTeamAbbreviation ?? gameState?.homeTeamId ?? '',
    away_team: info?.awayTeamAbbreviation ?? gameState?.awayTeamId ?? '',
    score: { home: gameState?.scoreHome ?? 0, away: gameState?.scoreAway ?? 0 },
    quarter: gameState?.quarter ?? 0,
    time_remaining_sec: gameState?.timeRemainingSec ?? 0,
  };
}
