import type { FlagEvent, FlagState } from '@fantasy-focus/shared';

/**
 * Re-validation before firing (Section 8 `flagEventDispatcher`), extended per Sprint 4 closeout item
 * #1: a deferred event must clear TWO INDEPENDENT gates, not just the state check Section 8's
 * pseudocode shows —
 *
 *  (a) State freshness (`isEventStateFresh`) — the `FlagState` this event was generated from must
 *      still be the CURRENTLY stored one. `onPlayEvent` overwrites `user_flag_state:{user}:{game}`
 *      every time it emits a new event; if a later play has since produced a newer `FlagState`, this
 *      queued event is superseded and stale, even though the user may still be perfectly active.
 *  (b) Liveness (`userIsActive`) — the user must currently be in `active_users`. A user who
 *      disconnected/went inactive during the deferral window must have the event dropped even though
 *      the flag state itself hasn't changed at all (this is the exact bug Sprint 4 discovered: a
 *      stored `flagged: true` state was being trusted as ground truth for an inactive user).
 *
 * Both gates are independent and both must pass — neither is a substitute for the other.
 */
export function isEventStateFresh(event: FlagEvent, currentState: FlagState | null): boolean {
  if (!currentState) return false;
  return (
    currentState.computedAt === event.newState.computedAt &&
    currentState.flagged === event.newState.flagged &&
    currentState.priorityScore === event.newState.priorityScore
  );
}

export function isStillRelevant(
  event: FlagEvent,
  currentState: FlagState | null,
  userIsActive: boolean,
): boolean {
  return isEventStateFresh(event, currentState) && userIsActive;
}
