import type { GameState } from '@pivot/shared';
import { TRIGGER_KIND, type Stake, type Trigger, type TriggerCode } from '../types.js';

/** One regulation quarter is 15 minutes. OT does not scale by the clock. */
const QUARTER_SECONDS = 900;

/**
 * Late-game leverage on [0, 1]. Tighter is higher and later is higher:
 * `0.5 × closeness + 0.5 × lateness`, where
 * closeness = 1 − |distance| / threshold and
 * lateness = 1 − timeRemainingSec / 900 within the quarter.
 * OT lateness is 1. Closeness, lateness, and the average are clamped to [0, 1].
 */
export function lateGameLeverage(distance: number, threshold: number, game: GameState): number {
  const closeness = clamp01(1 - Math.abs(distance) / threshold);
  const lateness = game.quarter >= 5 ? 1 : clamp01(1 - game.timeRemainingSec / QUARTER_SECONDS);
  return clamp01(0.5 * closeness + 0.5 * lateness);
}

export function isLate(quarter: number): boolean {
  return quarter >= 4;
}

/** Subject score minus opponent score, or null when that team is not home or away. */
export function marginFor(game: GameState, teamId: string): number | null {
  if (!hasTeams(game)) return null;
  if (teamId === game.homeTeamId) return game.scoreHome - game.scoreAway;
  if (teamId === game.awayTeamId) return game.scoreAway - game.scoreHome;
  return null;
}

export function hasTeams(game: GameState): boolean {
  return game.homeTeamId !== '' && game.awayTeamId !== '';
}

export function revealTrigger(stake: Stake, code: TriggerCode, leverage: number): Trigger {
  return {
    stakeId: stake.id,
    gameId: stake.gameId,
    code,
    kind: TRIGGER_KIND[code],
    leverage,
    // Per-drive dedupe arrives with a drive id later, same as ROSTERED.
    dedupeKey: `${stake.id}:${code}`,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
