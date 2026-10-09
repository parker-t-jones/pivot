import type { StakeEvaluator } from '../types.js';
import { hasTeams, isLate, lateGameLeverage, marginFor, revealTrigger } from './lateGame.js';

/** |margin + line| within 3. Distance is margin + line; the closeness threshold is 3. */
const SPREAD_WINDOW = 3;

/** Pure SPREAD_SWING evaluator. Nothing in the engine calls it yet. */
export const evaluateSpreadSwing: StakeEvaluator = (stake, ctx) => {
  if (stake.condition.type !== 'SPREAD') return [];
  if (stake.subject.type !== 'TEAM') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game) || !isLate(ctx.game.quarter)) return [];

  const margin = marginFor(ctx.game, stake.subject.teamId);
  if (margin === null) return [];
  const distance = margin + stake.condition.line;
  if (Math.abs(distance) > SPREAD_WINDOW) return [];

  return [
    revealTrigger(stake, 'SPREAD_SWING', lateGameLeverage(distance, SPREAD_WINDOW, ctx.game)),
  ];
};
