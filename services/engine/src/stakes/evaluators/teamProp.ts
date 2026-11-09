import { isDecided, pickProgress } from '../progress/pickProgress.js';
import { segmentInPlay } from '../progress/segment.js';
import type { StakeEvaluator } from '../types.js';
import { revealTrigger } from './lateGame.js';

/** Leverage while the team has the ball, and in the red zone (docs/P2-PICKS-MODEL.md §4). */
export const TEAM_PROP_LEVERAGE = 0.6;
export const TEAM_PROP_RED_ZONE_LEVERAGE = 0.9;

/**
 * Team props: TEAM_TOTAL_OVER/UNDER, FIRST_TO_SCORE, and FG_OVER/UNDER on one team. Active when
 * that team has the ball while the pick's segment is being played. `TEAM_PROP_POSSESSION` is a
 * NUDGE and fires decided or not (a decided pick only drops to zero leverage), so the nudge never
 * reveals the outcome by stopping.
 */
export const evaluateTeamProp: StakeEvaluator = (stake, ctx) => {
  const condition = stake.condition;
  const type = condition.type;
  if (
    type !== 'TEAM_TOTAL_OVER' &&
    type !== 'TEAM_TOTAL_UNDER' &&
    type !== 'FIRST_TO_SCORE' &&
    type !== 'FG_OVER' &&
    type !== 'FG_UNDER'
  ) {
    return [];
  }
  if (stake.subject.type !== 'TEAM') return [];
  if (stake.gameId !== ctx.gameId) return [];
  const teamId = stake.subject.teamId;
  if (teamId !== ctx.game.homeTeamId && teamId !== ctx.game.awayTeamId) return [];
  if (ctx.game.status !== 'in_progress') return [];
  if (ctx.game.possessionTeamId !== teamId) return [];

  const segment = 'segment' in condition ? condition.segment : undefined;
  if (!segmentInPlay(segment, ctx.game, ctx.playerStats)) return [];

  const decided = isDecided(pickProgress(stake, ctx));

  const leverage = decided
    ? 0
    : ctx.game.inRedZone
      ? TEAM_PROP_RED_ZONE_LEVERAGE
      : TEAM_PROP_LEVERAGE;
  return [revealTrigger(stake, 'TEAM_PROP_POSSESSION', leverage)];
};
