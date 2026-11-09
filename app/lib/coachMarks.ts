import {
  hasSeenCoachMark,
  withCoachMarkSeen,
  type CoachMarkId,
} from '@pivot/shared/preferences';

export { withCoachMarkSeen, type CoachMarkId };

/**
 * The coach mark to show on this screen visit, or `null` if there is none left to show.
 * "Never show more than one coach mark per screen visit" (§12.2) — callers pass every candidate
 * id for the screen, in priority order, and only the first unseen one comes back.
 */
export function pickCoachMarkToShow(
  candidates: readonly CoachMarkId[],
  seen: readonly string[],
): CoachMarkId | null {
  for (const id of candidates) {
    if (!hasSeenCoachMark(seen, id)) return id;
  }
  return null;
}
