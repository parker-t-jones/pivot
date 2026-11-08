import { segmentComplete, segmentLate, segmentPoints, sideOf } from '../progress/segment.js';
import type { StakeEvaluator } from '../types.js';
import { hasTeams, isLate, lateGameLeverage, marginFor, revealTrigger } from './lateGame.js';

/** |margin + line| within 3. Distance is margin + line; the closeness threshold is 3. */
const SPREAD_WINDOW = 3;

/**
 * Pure SPREAD_SWING evaluator. A full-game spread uses the live score in Q4 and OT. A quarter or
 * half spread uses that segment's linescores late in the segment (docs/P2-PICKS-MODEL.md §4).
 */
export const evaluateSpreadSwing: StakeEvaluator = (stake, ctx) => {
  if (stake.condition.type !== 'SPREAD') return [];
  if (stake.subject.type !== 'TEAM') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (ctx.game.status === 'final') return [];
  if (!hasTeams(ctx.game)) return [];

  const segment = stake.condition.segment;
  let margin: number | null;
  if (segment === undefined) {
    if (!isLate(ctx.game.quarter)) return [];
    margin = marginFor(ctx.game, stake.subject.teamId);
  } else {
    if (!segmentLate(segment, ctx.game) || segmentComplete(segment, ctx.game, ctx.playerStats)) {
      return [];
    }
    if (ctx.playerStats === undefined) return [];
    const side = sideOf(ctx.game, stake.subject.teamId);
    margin =
      side === null
        ? null
        : segmentPoints(side, segment, ctx.game, ctx.playerStats) -
          segmentPoints(side === 'home' ? 'away' : 'home', segment, ctx.game, ctx.playerStats);
  }
  if (margin === null) return [];
  const distance = margin + stake.condition.line;
  if (Math.abs(distance) > SPREAD_WINDOW) return [];

  return [
    revealTrigger(stake, 'SPREAD_SWING', lateGameLeverage(distance, SPREAD_WINDOW, ctx.game)),
  ];
};
