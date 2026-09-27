import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { collapseByUser, isPushEligibleEvent } from './collapseFlagEvents.js';

function event(overrides: {
  id: string;
  userId?: string;
  priorityScore: number;
  flagged?: boolean;
  computedAt?: number;
}): FlagEvent {
  const state: FlagState = {
    gameId: 'g1',
    flagged: overrides.flagged ?? true,
    priorityScore: overrides.priorityScore,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: overrides.computedAt ?? 1,
  };
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: state,
    scheduledFireAt: 0,
  };
}

describe('isPushEligibleEvent', () => {
  it('only flag_added is push-eligible', () => {
    expect(isPushEligibleEvent('flag_added')).toBe(true);
    expect(isPushEligibleEvent('priority_increased')).toBe(false);
    expect(isPushEligibleEvent('priority_decreased')).toBe(false);
    expect(isPushEligibleEvent('flag_removed')).toBe(false);
  });
});

describe('collapseByUser', () => {
  it('keeps the higher priorityScore', () => {
    const low = event({ id: 'low', priorityScore: 2 });
    const high = event({ id: 'high', priorityScore: 9 });
    expect(collapseByUser([{ event: low }, { event: high }]).map((item) => item.event.id)).toEqual([
      'high',
    ]);
  });

  it('prefers flagged when priorityScore ties', () => {
    const unflagged = event({ id: 'off', priorityScore: 5, flagged: false });
    const flagged = event({ id: 'on', priorityScore: 5, flagged: true });
    expect(
      collapseByUser([{ event: unflagged }, { event: flagged }]).map((item) => item.event.id),
    ).toEqual(['on']);
  });

  it('prefers the later computedAt when score and flagged tie', () => {
    const earlier = event({ id: 'early', priorityScore: 5, flagged: true, computedAt: 1 });
    const later = event({ id: 'late', priorityScore: 5, flagged: true, computedAt: 2 });
    expect(
      collapseByUser([{ event: earlier }, { event: later }]).map((item) => item.event.id),
    ).toEqual(['late']);
  });

  it('does not merge a different user', () => {
    const a = event({ id: 'a', userId: 'u1', priorityScore: 2 });
    const b = event({ id: 'b', userId: 'u2', priorityScore: 1 });
    expect(collapseByUser([{ event: a }, { event: b }])).toHaveLength(2);
  });
});
