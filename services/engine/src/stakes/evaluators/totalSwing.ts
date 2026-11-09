import { segmentComplete, segmentLate, segmentPoints } from '../progress/segment.js';
import type { StakeEvaluator } from '../types.js';
import { hasTeams, isLate, lateGameLeverage, revealTrigger } from './lateGame.js';

/**
 * Points still needed to land on the total, from 0 through 7.
 * Distance is line − (home + away). Once the total is past the line, this stays silent.
 */
const TOTAL_WINDOW = 7;

/**
 * Pure TOTAL_SWING evaluator. A full-game total uses the live score in Q4 and OT. A quarter or
 * half total uses that segment's linescores late in the segment (docs/P2-PICKS-MODEL.md §4).
 */
export const evaluateTotalSwing: StakeEvaluator = (stake, ctx) => {
  const condition = stake.condition.type;
  if (condition !== 'TOTAL_OVER' && condition !== 'TOTAL_UNDER') return [];
  if (stake.subject.type !== 'GAME') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game)) return [];

  const segment = stake.condition.segment;
  let total: number;
  if (segment === undefined) {
    if (!isLate(ctx.game.quarter)) return [];
    total = ctx.game.scoreHome + ctx.game.scoreAway;
  } else {
    if (!segmentLate(segment, ctx.game) || segmentComplete(segment, ctx.game, ctx.playerStats)) {
      return [];
    }
    if (ctx.playerStats === undefined) return [];
    total =
      segmentPoints('home', segment, ctx.game, ctx.playerStats) +
      segmentPoints('away', segment, ctx.game, ctx.playerStats);
  }

  const needed = stake.condition.line - total;
  if (needed < 0 || needed > TOTAL_WINDOW) return [];

  return [revealTrigger(stake, 'TOTAL_SWING', lateGameLeverage(needed, TOTAL_WINDOW, ctx.game))];
};
