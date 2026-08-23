import type { GameState } from '@pivot/shared';
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
  /** Sprint 6 Phase 3 addition (batched Section 9 spec update) — team nicknames alongside the
   *  existing abbreviations, additive so no existing consumer's shape changes underneath it. */
  home_team_name: string;
  away_team_name: string;
  /** Sprint 9 Phase 1 addition — closes the "team color flash not implemented" Known Issue
   *  (Section 13). Hex strings from `teams.primary_color`/`secondary_color` (Section 7); empty
   *  string when `info` is unavailable, matching the existing name/abbreviation fallback below
   *  rather than `null`, since `GameSummary`'s other string fields never carry `null`. */
  home_team_primary_color: string;
  home_team_secondary_color: string;
  away_team_primary_color: string;
  away_team_secondary_color: string;
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
    home_team_name: info?.homeTeamName ?? gameState?.homeTeamId ?? '',
    away_team_name: info?.awayTeamName ?? gameState?.awayTeamId ?? '',
    home_team_primary_color: info?.homeTeamPrimaryColor ?? '',
    home_team_secondary_color: info?.homeTeamSecondaryColor ?? '',
    away_team_primary_color: info?.awayTeamPrimaryColor ?? '',
    away_team_secondary_color: info?.awayTeamSecondaryColor ?? '',
    score: { home: gameState?.scoreHome ?? 0, away: gameState?.scoreAway ?? 0 },
    quarter: gameState?.quarter ?? 0,
    time_remaining_sec: gameState?.timeRemainingSec ?? 0,
  };
}
