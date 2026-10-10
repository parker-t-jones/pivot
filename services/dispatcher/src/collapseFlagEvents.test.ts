import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { collapseByUser, isPushEligibleEvent } from './collapseFlagEvents.js';

function event(overrides: {
  id: string;
  userId?: string;
  priorityScore: number;
  flagged?: boolean;
  computedAt?: number;
  type?: FlagEvent['type'];
}): FlagEvent {
  const state: FlagState = {
    gameId: 'g1',
    flagged: overrides.flagged ?? true,
    priorityScore: overrides.priorityScore,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: overrides.computedAt ?? 1,
  };
  const type = overrides.type ?? 'flag_added';
  if (type === 'bet_in_play') {
    return {
      id: overrides.id,
      userId: overrides.userId ?? 'u1',
      gameId: 'g1',
      type,
      stakeId: 'stake-1',
      code: 'TOTAL_SWING',
      label: 'Over 47.5',
      oldState: null,
      newState: state,
      scheduledFireAt: 0,
    };
  }
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'u1',
    gameId: 'g1',
    type,
    oldState: null,
    newState: state,
    scheduledFireAt: 0,
  };
}

describe('isPushEligibleEvent', () => {
  it('treats flag_added and bet_in_play as push-eligible', () => {
    expect(isPushEligibleEvent('flag_added')).toBe(true);
    expect(isPushEligibleEvent('bet_in_play')).toBe(true);
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

  it('keeps the higher score whether the bet or the flag leads', () => {
    const bet = event({ id: 'bet', priorityScore: 9, type: 'bet_in_play' });
    const flag = event({ id: 'flag', priorityScore: 2 });
    expect(collapseByUser([{ event: flag }, { event: bet }]).map((item) => item.event.id)).toEqual([
      'bet',
    ]);
    expect(collapseByUser([{ event: bet }, { event: flag }]).map((item) => item.event.id)).toEqual([
      'bet',
    ]);

    const louder = event({ id: 'flag', priorityScore: 9 });
    const quiet = event({ id: 'bet', priorityScore: 2, type: 'bet_in_play' });
    expect(
      collapseByUser([{ event: quiet }, { event: louder }]).map((item) => item.event.id),
    ).toEqual(['flag']);
    expect(
      collapseByUser([{ event: louder }, { event: quiet }]).map((item) => item.event.id),
    ).toEqual(['flag']);
  });

  it('prefers flag_added when priorityScore ties with bet_in_play', () => {
    const bet = event({ id: 'bet', priorityScore: 5, type: 'bet_in_play', computedAt: 9 });
    const flag = event({ id: 'flag', priorityScore: 5, computedAt: 1 });
    expect(collapseByUser([{ event: bet }, { event: flag }]).map((item) => item.event.id)).toEqual([
      'flag',
    ]);
    expect(collapseByUser([{ event: flag }, { event: bet }]).map((item) => item.event.id)).toEqual([
      'flag',
    ]);
  });

  it('does not merge a different user', () => {
    const a = event({ id: 'a', userId: 'u1', priorityScore: 2 });
    const b = event({ id: 'b', userId: 'u2', priorityScore: 1 });
    expect(collapseByUser([{ event: a }, { event: b }])).toHaveLength(2);
  });
});
