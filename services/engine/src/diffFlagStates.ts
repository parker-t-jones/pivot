import { createHash } from 'node:crypto';
import type { FlagEvent, FlagState } from '@pivot/shared';

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

/** Reason kinds, or the players named on them, are a different flag even at the same priority. */
function compositionChanged(oldState: FlagState, newState: FlagState): boolean {
  const oldKinds = sortedUnique(oldState.reasons.map((reason) => reason.type));
  const newKinds = sortedUnique(newState.reasons.map((reason) => reason.type));
  if (!sameSet(oldKinds, newKinds)) return true;
  const oldPlayers = sortedUnique(oldState.reasons.flatMap((reason) => reason.triggeringPlayerIds));
  const newPlayers = sortedUnique(newState.reasons.flatMap((reason) => reason.triggeringPlayerIds));
  return !sameSet(oldPlayers, newPlayers);
}

/**
 * Pure diff of two flag states into a `FlagEvent`, or `null` when the change isn't worth an event
 * (PLAN.md Section 8 "Diff to event").
 *
 * A new flag, a cleared flag, or a change in reason kinds or triggering players is always an event.
 * Reason and player changes use `flag_added` so they push and replace what Home is showing, whatever
 * the priority delta is. The ±3 band applies only when both of those sets are unchanged.
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

  if (oldState && compositionChanged(oldState, newState)) {
    return makeEvent(userId, oldState, newState, 'flag_added');
  }

  const delta = newState.priorityScore - (oldState?.priorityScore ?? 0);
  if (delta >= 3) return makeEvent(userId, oldState, newState, 'priority_increased');
  if (delta <= -3) return makeEvent(userId, oldState, newState, 'priority_decreased');

  return null;
}
