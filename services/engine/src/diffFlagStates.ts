import { createHash } from 'node:crypto';
import type { FlagEvent, FlagState } from '@roster-remote/shared';

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

/**
 * Pure diff of two flag states into a `FlagEvent`, or `null` when the change isn't worth an event
 * (PLAN.md Section 8 "Diff to event"). Priority-delta threshold is ±3, verbatim from Section 8.
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

  const delta = newState.priorityScore - (oldState?.priorityScore ?? 0);
  if (delta >= 3) return makeEvent(userId, oldState, newState, 'priority_increased');
  if (delta <= -3) return makeEvent(userId, oldState, newState, 'priority_decreased');

  return null;
}
