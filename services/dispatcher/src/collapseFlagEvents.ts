import type { FlagEvent } from '@pivot/shared';

/**
 * The only event type that sends a push (Decision 7). Collapse and the rate limiter
 * count these and nothing else. The other three types are persisted and published.
 */
const PUSH_ELIGIBLE_EVENT_TYPES: ReadonlySet<FlagEvent['type']> = new Set(['flag_added']);

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
  return [...groups.values()].map((group) => {
    let winner = group[0]!;
    for (const item of group.slice(1)) {
      if (outranks(item.event, winner.event)) winner = item;
    }
    return winner;
  });
}
