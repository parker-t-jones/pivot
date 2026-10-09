import type { StakeEvaluator } from '../types.js';
import { hasTeams, lateGameLeverage, marginFor, revealTrigger } from './lateGame.js';

/**
 * Any deficit in the second half, including OT. Tied is not trailing.
 * Closeness uses the one-score scale so a smaller deficit is tighter.
 */
const TRAILING_SCALE = 8;

/** Pure PICK_TRAILING_2H evaluator. Nothing in the engine calls it yet. */
export const evaluatePickTrailing2h: StakeEvaluator = (stake, ctx) => {
  if (stake.condition.type !== 'SURVIVOR') return [];
  if (stake.subject.type !== 'TEAM') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game) || ctx.game.quarter < 3) return [];

  const margin = marginFor(ctx.game, stake.subject.teamId);
  if (margin === null || margin >= 0) return [];

  return [
    revealTrigger(stake, 'PICK_TRAILING_2H', lateGameLeverage(margin, TRAILING_SCALE, ctx.game)),
  ];
};
