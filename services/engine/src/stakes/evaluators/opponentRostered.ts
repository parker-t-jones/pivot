import type { LineupUnit, UserLineupCache } from '@pivot/shared';
import { computeFlagState } from '../../computeFlagState.js';
import { priorityToLeverage } from './rostered.js';
import { TRIGGER_KIND, type Stake, type StakeEvaluator, type Trigger } from '../types.js';

/**
 * One opponent player, with no stars.
 * A star on the opponent cache must not change leverage.
 */
function onePlayerCache(
  lineup: UserLineupCache,
  playerId: string,
  teamId: string,
): UserLineupCache {
  const teamUnits = lineup.teamPositions.get(teamId);
  const teamPositions = new Map<string, Set<LineupUnit>>();
  if (teamUnits) teamPositions.set(teamId, new Set(teamUnits));

  const cache: UserLineupCache = {
    userId: lineup.userId,
    week: lineup.week,
    teamPositions,
    playerToTeam: new Map([[playerId, teamId]]),
    starPlayerIds: new Set(),
  };

  if (lineup.playerUnits) {
    const unit = lineup.playerUnits.get(playerId);
    cache.playerUnits = unit === undefined ? new Map() : new Map([[playerId, unit]]);
  }

  return cache;
}

function trigger(stake: Stake, leverage: number): Trigger {
  return {
    stakeId: stake.id,
    gameId: stake.gameId,
    code: 'OPP_RED_ZONE',
    kind: TRIGGER_KIND.OPP_RED_ZONE,
    leverage,
    dedupeKey: `${stake.id}:OPP_RED_ZONE`,
  };
}

/** Pure OPPONENT_ROSTERED evaluator. Nothing in the engine calls it yet. */
export const evaluateOpponentRostered: StakeEvaluator = (stake, ctx) => {
  if (stake.condition.type !== 'OPPONENT_ROSTERED') return [];
  if (stake.subject.type !== 'PLAYER') return [];
  if (stake.gameId !== ctx.gameId) return [];
  if (!ctx.opponent) return [];

  const playerId = stake.subject.playerId;
  const teamId = ctx.opponent.playerToTeam.get(playerId);
  if (teamId === undefined || teamId !== stake.subject.teamId) return [];

  const flag = computeFlagState(onePlayerCache(ctx.opponent, playerId, teamId), ctx.game);
  const onOffense = flag.reasons.some(
    (reason) => reason.type === 'offense_active' && reason.triggeringPlayerIds.includes(playerId),
  );
  const inRedZone = flag.reasons.some((reason) => reason.type === 'red_zone');
  if (!onOffense || !inRedZone) return [];

  return [trigger(stake, priorityToLeverage(flag.priorityScore))];
};
