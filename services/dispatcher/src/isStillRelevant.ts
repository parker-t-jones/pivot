import type { FlagEvent, FlagState } from '@pivot/shared';

/**
 * Re-validation before firing (Section 8 `flagEventDispatcher`).
 *
 * State freshness: the `FlagState` this event was generated from must still be the stored one.
 * `onPlayEvent` overwrites `user_flag_state:{user}:{game}` every time it emits a new event; a later
 * play that stored a newer `FlagState` supersedes this one.
 *
 * Decision 8: an active socket is not a gate. A user absent from `active_users` still receives the
 * event and the push.
 */
export function isEventStateFresh(event: FlagEvent, currentState: FlagState | null): boolean {
  if (!currentState) return false;
  return (
    currentState.computedAt === event.newState.computedAt &&
    currentState.flagged === event.newState.flagged &&
    currentState.priorityScore === event.newState.priorityScore
  );
}

export function isStillRelevant(event: FlagEvent, currentState: FlagState | null): boolean {
  return isEventStateFresh(event, currentState);
}
