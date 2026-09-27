import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { isEventStateFresh, isStillRelevant } from './isStillRelevant.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 6,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 1_700_000_060_000,
    ...overrides,
  };
}

describe('isEventStateFresh (gate a — state freshness)', () => {
  it('is fresh when the stored state exactly matches what the event was generated from', () => {
    const event = makeEvent();
    expect(isEventStateFresh(event, makeFlagState())).toBe(true);
  });

  it('is stale when there is no stored state at all', () => {
    expect(isEventStateFresh(makeEvent(), null)).toBe(false);
  });

  it('is stale when a later play changed computedAt (a newer event superseded this one)', () => {
    const event = makeEvent();
    const superseding = makeFlagState({ computedAt: 1_700_000_030_000 });
    expect(isEventStateFresh(event, superseding)).toBe(false);
  });

  it('is stale when priorityScore has since drifted', () => {
    const event = makeEvent();
    const drifted = makeFlagState({ priorityScore: 9 });
    expect(isEventStateFresh(event, drifted)).toBe(false);
  });

  it('is stale when flagged has since flipped', () => {
    const event = makeEvent();
    const flipped = makeFlagState({ flagged: false });
    expect(isEventStateFresh(event, flipped)).toBe(false);
  });
});

describe('isStillRelevant — freshness only', () => {
  it('passes when the stored state matches, including when the user has no socket', () => {
    expect(isStillRelevant(makeEvent(), makeFlagState())).toBe(true);
  });

  it('drops a stale event', () => {
    const superseded = makeFlagState({ priorityScore: 12, computedAt: 1_700_000_045_000 });
    expect(isStillRelevant(makeEvent(), superseded)).toBe(false);
  });

  it('drops when there is no stored state', () => {
    expect(isStillRelevant(makeEvent(), null)).toBe(false);
  });
});
