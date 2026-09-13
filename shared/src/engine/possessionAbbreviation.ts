import type { GameState } from './types.js';

/**
 * Abbreviation of the team that currently has the ball, or `null` when there's no possession
 * (special teams / between plays / kickoff) or the id doesn't match home/away.
 *
 * Shared by `GET /games/live`, the WebSocket `flag_event` envelope's `new_state.possession_team`,
 * and `buildGameSummary`'s `possession_team` so the three call sites can't silently diverge.
 */
export function resolvePossessionAbbreviation(
  gameState: Pick<GameState, 'possessionTeamId' | 'homeTeamId' | 'awayTeamId'> | null,
  homeAbbreviation: string | null | undefined,
  awayAbbreviation: string | null | undefined,
): string | null {
  if (!gameState?.possessionTeamId) return null;
  if (gameState.possessionTeamId === gameState.homeTeamId) return homeAbbreviation ?? null;
  if (gameState.possessionTeamId === gameState.awayTeamId) return awayAbbreviation ?? null;
  return null;
}
