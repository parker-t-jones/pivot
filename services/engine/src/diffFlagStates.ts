import { createHash } from 'node:crypto';
import type { FlagEvent, FlagReasonType, FlagState } from '@pivot/shared';

type FlagEventType = FlagEvent['type'];

/**
 * Deterministic event id: a hash of (userId, gameId, type, computedAt). Deterministic so tests can
 * assert on ids without flakiness, and stable across recomputes of the same delta. `createHash` is a
 * pure computation (no I/O), so `diffFlagStates` stays pure.
 */
function eventId(userId: string, gameId: string, type: FlagEventType, computedAt: number): string {
  return createHash('sha1').update(`${userId}:${gameId}:${type}:${computedAt}`).digest('hex');
}

function makeEvent(
  userId: string,
  oldState: FlagState | null,
  newState: FlagState,
  type: FlagEventType,
): FlagEvent {
  return {
    id: eventId(userId, newState.gameId, type, newState.computedAt),
    userId,
    gameId: newState.gameId,
    type,
    oldState,
    newState,
    // Placeholder: Sprint 5's dispatcher overwrites this with the real stream-lag-deferred timestamp
    // (Section 8 `scheduleFlagEvent`). Deferred firing is out of scope this sprint.
    scheduledFireAt: newState.computedAt,
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Base reasons that name who has the ball. The other `FlagReasonType` values — `red_zone`,
 * `close_game`, `star_player_active` — are bonuses and stay on the ±3 band.
 */
const SIDE_OF_BALL_REASONS: ReadonlySet<FlagReasonType> = new Set(['offense_active', 'defense_active']);

/** Side of the ball, or the players named on it, is a different flag even at the same priority. */
function sideOrPlayersChanged(oldState: FlagState, newState: FlagState): boolean {
  const oldSide = oldState.reasons.filter((reason) => SIDE_OF_BALL_REASONS.has(reason.type));
  const newSide = newState.reasons.filter((reason) => SIDE_OF_BALL_REASONS.has(reason.type));
  const oldKinds = sortedUnique(oldSide.map((reason) => reason.type));
  const newKinds = sortedUnique(newSide.map((reason) => reason.type));
  if (!sameSet(oldKinds, newKinds)) return true;
  const oldPlayers = sortedUnique(oldSide.flatMap((reason) => reason.triggeringPlayerIds));
  const newPlayers = sortedUnique(newSide.flatMap((reason) => reason.triggeringPlayerIds));
  return !sameSet(oldPlayers, newPlayers);
}

/**
 * Pure diff of two flag states into a `FlagEvent`, or `null` when the change isn't worth an event
 * (PLAN.md Section 8 "Diff to event").
 *
 * A new flag, a cleared flag, or a change of side (`offense_active` / `defense_active`) or of the
 * players on that side is always `flag_added`, so it pushes and replaces what Home is showing.
 * Bonus reasons go through the ±3 band: `priority_increased` / `priority_decreased`, or null.
 */
export function diffFlagStates(
  userId: string,
  oldState: FlagState | null,
  newState: FlagState,
): FlagEvent | null {
  const wasFlagged = oldState?.flagged ?? false;
  const isFlagged = newState.flagged;

  if (!wasFlagged && !isFlagged) return null;
  if (!wasFlagged && isFlagged) return makeEvent(userId, oldState, newState, 'flag_added');
  if (wasFlagged && !isFlagged) return makeEvent(userId, oldState, newState, 'flag_removed');

  if (oldState && sideOrPlayersChanged(oldState, newState)) {
    return makeEvent(userId, oldState, newState, 'flag_added');
  }

  const delta = newState.priorityScore - (oldState?.priorityScore ?? 0);
  if (delta >= 3) return makeEvent(userId, oldState, newState, 'priority_increased');
  if (delta <= -3) return makeEvent(userId, oldState, newState, 'priority_decreased');

  return null;
}
