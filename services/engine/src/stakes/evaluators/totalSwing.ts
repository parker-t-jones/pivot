import type { StakeEvaluator } from '../types.js';
import { hasTeams, isLate, lateGameLeverage, revealTrigger } from './lateGame.js';

/**
 * Points still needed to land on the total, from 0 through 7.
 * Distance is line − (home + away). Once the total is past the line, this stays silent.
 */
const TOTAL_WINDOW = 7;

/** Pure TOTAL_SWING evaluator. Nothing in the engine calls it yet. */
export const evaluateTotalSwing: StakeEvaluator = (stake, ctx) => {
  const condition = stake.condition.type;
  if (condition !== 'TOTAL_OVER' && condition !== 'TOTAL_UNDER') return [];
  if (stake.subject.type !== 'GAME') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game) || !isLate(ctx.game.quarter)) return [];

  const needed = stake.condition.line - (ctx.game.scoreHome + ctx.game.scoreAway);
  if (needed < 0 || needed > TOTAL_WINDOW) return [];

  return [revealTrigger(stake, 'TOTAL_SWING', lateGameLeverage(needed, TOTAL_WINDOW, ctx.game))];
};
