import { STAT_BIG_PLAY, type LineupUnit, type StatKey, type UserLineupCache } from '@pivot/shared';
import { computeFlagState } from '../../computeFlagState.js';
import { isDecided, pickProgress } from '../progress/pickProgress.js';
import type { PropPlayer, StakeEvaluator, Trigger } from '../types.js';
import { revealTrigger } from './lateGame.js';
import { priorityToLeverage } from './rostered.js';

/** Share of the line that counts as "near" (PIVOT-STAKES-PLAN §3). */
export const PROP_NEAR_SHARE = 0.8;

/** Red-zone bonus for TD props, capped at 1. */
const TD_RED_ZONE_BONUS = 0.25;

/**
 * The fantasy activity rule's input for one player: their team gated to their side of the ball.
 * Same shape the ROSTERED evaluator builds from the user's lineup, built here from `players`.
 */
export function propPlayerCache(
  player: PropPlayer,
  unit: LineupUnit = player.unit,
): UserLineupCache {
  return {
    userId: '',
    week: 0,
    teamPositions: new Map([[player.teamId, new Set<LineupUnit>([unit])]]),
    playerToTeam: new Map([[player.playerId, player.teamId]]),
    starPlayerIds: new Set(),
    playerUnits: new Map([[player.playerId, unit]]),
  };
}

function statOf(stake: Parameters<StakeEvaluator>[0]): StatKey | null {
  const condition = stake.condition;
  if (condition.type === 'STAT_OVER' || condition.type === 'STAT_UNDER') return condition.stat;
  if (condition.type === 'PLAYER_EVENT') return 'ANY_TD';
  return null;
}

/**
 * Proximity on [0, 1]: how close an over is to clearing, or an under to going over. One big play
 * away or less is 1 once doubled; two or more big plays away is 0.
 */
export function propProximity(needed: number, stat: StatKey): number {
  const bigPlay = STAT_BIG_PLAY[stat];
  return Math.max(0, 1 - Math.min(needed / (2 * bigPlay), 1));
}

/**
 * Player props: STAT_OVER, STAT_UNDER, PLAYER_EVENT (docs/P2-PICKS-MODEL.md §4, §6).
 *
 * - `PROP_LIVE_POSSESSION` (NUDGE) whenever the fantasy rule says the player is active, decided or
 *   not. Skipping decided props would let the nudge's absence reveal the outcome.
 * - `PROP_NEAR` (over) / `PROP_DANGER` (under), REVEALs, while undecided and the stat is at least
 *   80% of the line or within one big play of it. A stat still at 0 is never near.
 */
export const evaluatePlayerProp: StakeEvaluator = (stake, ctx) => {
  const type = stake.condition.type;
  if (type !== 'STAT_OVER' && type !== 'STAT_UNDER' && type !== 'PLAYER_EVENT') return [];
  if (stake.subject.type !== 'PLAYER') return [];
  if (stake.gameId !== ctx.gameId) return [];
  const player = ctx.player;
  if (player === undefined || player.playerId !== stake.subject.playerId) return [];
  if (player.teamId !== ctx.game.homeTeamId && player.teamId !== ctx.game.awayTeamId) return [];
  if (ctx.game.status !== 'in_progress') return [];

  const progress = pickProgress(stake, ctx);
  const decided = isDecided(progress);
  const stat = statOf(stake);
  const isTdProp = stat === 'ANY_TD' || stat === 'PASS_TD';

  const flag = computeFlagState(propPlayerCache(player), ctx.game);
  const active = flag.reasons.some((reason) =>
    reason.triggeringPlayerIds.includes(player.playerId),
  );
  const inRedZone = flag.reasons.some((reason) => reason.type === 'red_zone');

  const proximity =
    stat !== null && progress.needed !== undefined ? propProximity(progress.needed, stat) : 0;
  let leverage = decided ? 0 : priorityToLeverage(flag.priorityScore) * (0.5 + 0.5 * proximity);
  if (!decided && isTdProp && inRedZone) leverage = Math.min(1, leverage + TD_RED_ZONE_BONUS);

  const triggers: Trigger[] = [];
  if (active) triggers.push(revealTrigger(stake, 'PROP_LIVE_POSSESSION', leverage));

  if (
    progress.status === 'live' &&
    stat !== null &&
    type !== 'PLAYER_EVENT' &&
    progress.current !== undefined &&
    progress.current > 0 &&
    progress.line !== undefined &&
    progress.needed !== undefined
  ) {
    const near =
      progress.current >= PROP_NEAR_SHARE * progress.line ||
      progress.needed <= STAT_BIG_PLAY[stat] - (type === 'STAT_UNDER' ? 1 : 0);
    if (near) {
      const code = type === 'STAT_OVER' ? 'PROP_NEAR' : 'PROP_DANGER';
      triggers.push(revealTrigger(stake, code, Math.max(leverage, 0.5 + 0.5 * proximity)));
    }
  }
  return triggers;
};
