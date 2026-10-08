import type { LineupUnit, UserLineupCache } from '@pivot/shared';
import { computeFlagState } from '../../computeFlagState.js';
import {
  TRIGGER_KIND,
  type Stake,
  type StakeEvaluator,
  type Trigger,
  type TriggerCode,
} from '../types.js';

/**
 * One-player flag priority onto [0, 1].
 * 12 is the one-player max (+2 side, +3 red zone, +2 close/late, +5 star).
 * Not used for ranking yet.
 */
export function priorityToLeverage(priority: number): number {
  return Math.min(priority / 12, 1);
}

/**
 * The team's position gates, plus this player's unit when the cache has per-player units.
 * Leaving `playerUnits` unset is the legacy path `computeFlagState` already implements.
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
    starPlayerIds: lineup.starPlayerIds.has(playerId) ? new Set([playerId]) : new Set(),
  };

  if (lineup.playerUnits) {
    const unit = lineup.playerUnits.get(playerId);
    cache.playerUnits = unit === undefined ? new Map() : new Map([[playerId, unit]]);
  }

  return cache;
}

function trigger(stake: Stake, code: TriggerCode, leverage: number): Trigger {
  return {
    stakeId: stake.id,
    gameId: stake.gameId,
    code,
    kind: TRIGGER_KIND[code],
    leverage,
    // ROSTERED edge detection stays in `diffFlagStates`. Per-drive dedupe arrives with S4b,
    // which must add a drive id to `GameState` first.
    dedupeKey: `${stake.id}:${code}`,
  };
}

/** Pure ROSTERED evaluator. Nothing in the engine calls it yet. */
export const evaluateRostered: StakeEvaluator = (stake, ctx) => {
  if (stake.condition.type !== 'ROSTERED') return [];
  if (stake.subject.type !== 'PLAYER') return [];
  if (stake.gameId !== ctx.gameId) return [];

  const playerId = stake.subject.playerId;
  const teamId = ctx.lineup.playerToTeam.get(playerId);
  if (teamId === undefined) return [];
  if (teamId !== stake.subject.teamId) return [];

  const flag = computeFlagState(onePlayerCache(ctx.lineup, playerId, teamId), ctx.game);
  const active = flag.reasons.some((reason) => reason.triggeringPlayerIds.includes(playerId));
  if (!active) return [];

  const leverage = priorityToLeverage(flag.priorityScore);
  const triggers = [trigger(stake, 'POSSESSION_START', leverage)];
  if (flag.reasons.some((reason) => reason.type === 'red_zone')) {
    triggers.push(trigger(stake, 'RED_ZONE', leverage));
  }
  return triggers;
};
