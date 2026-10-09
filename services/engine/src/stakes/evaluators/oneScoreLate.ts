import type { StakeEvaluator } from '../types.js';
import { hasTeams, isLate, lateGameLeverage, marginFor, revealTrigger } from './lateGame.js';

/** |margin| within 8. Distance is the margin; the closeness threshold is 8. */
const ONE_SCORE = 8;

/** Pure ONE_SCORE_LATE evaluator. Nothing in the engine calls it yet. */
export const evaluateOneScoreLate: StakeEvaluator = (stake, ctx) => {
  const condition = stake.condition.type;
  if (condition !== 'MONEYLINE' && condition !== 'SURVIVOR') return [];
  if (stake.subject.type !== 'TEAM') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game) || !isLate(ctx.game.quarter)) return [];

  const margin = marginFor(ctx.game, stake.subject.teamId);
  if (margin === null || Math.abs(margin) > ONE_SCORE) return [];

  return [revealTrigger(stake, 'ONE_SCORE_LATE', lateGameLeverage(margin, ONE_SCORE, ctx.game))];
};
