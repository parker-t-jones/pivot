import type { FlagEvent } from '@pivot/shared';

/**
 * Push-eligible events. Collapse and the rate limiter count these and nothing else.
 * `flag_removed` and the priority deltas are persisted and published.
 */
const PUSH_ELIGIBLE_EVENT_TYPES: ReadonlySet<FlagEvent['type']> = new Set([
  'flag_added',
  'bet_in_play',
]);

export function isPushEligibleEvent(type: FlagEvent['type']): boolean {
  return PUSH_ELIGIBLE_EVENT_TYPES.has(type);
}

/**
 * One reveal window emits one push-eligible event per user. Highest `priorityScore` wins. A tie
 * prefers `flagged === true`. A further tie prefers the later `computedAt`.
 */
export function outranks(candidate: FlagEvent, incumbent: FlagEvent): boolean {
  if (candidate.newState.priorityScore !== incumbent.newState.priorityScore) {
    return candidate.newState.priorityScore > incumbent.newState.priorityScore;
  }
  if (candidate.type !== incumbent.type) {
    if (candidate.type === 'flag_added' && incumbent.type === 'bet_in_play') return true;
    if (candidate.type === 'bet_in_play' && incumbent.type === 'flag_added') return false;
  }
  if (candidate.newState.flagged !== incumbent.newState.flagged) {
    return candidate.newState.flagged;
  }
  return candidate.newState.computedAt > incumbent.newState.computedAt;
}

export function collapseByUser<T extends { event: FlagEvent }>(items: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.event.userId) ?? [];
    list.push(item);
    groups.set(item.event.userId, list);
  }
  return [...groups.values()].map((group) =>
    group.reduce((winner, item) => (outranks(item.event, winner.event) ? item : winner)),
  );
}
