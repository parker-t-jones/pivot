import { describe, expect, it } from 'vitest';
import type { FlagState } from '@roster-remote/shared';
import { diffFlagStates } from './diffFlagStates.js';

const COMPUTED_AT = 1_700_000_000_000;

function flag(flagged: boolean, priorityScore: number): FlagState {
  return { gameId: 'game-1', flagged, priorityScore, reasons: [], computedAt: COMPUTED_AT };
}

describe('diffFlagStates', () => {
  it('returns null for unflagged → unflagged', () => {
    expect(diffFlagStates('user-1', flag(false, 0), flag(false, 0))).toBeNull();
  });

  it('treats a null old state as unflagged (null → unflagged is null)', () => {
    expect(diffFlagStates('user-1', null, flag(false, 0))).toBeNull();
  });

  it('returns flag_added for unflagged → flagged', () => {
    const oldState = flag(false, 0);
    const newState = flag(true, 2);
    const event = diffFlagStates('user-1', oldState, newState);

    expect(event).not.toBeNull();
    expect(event?.type).toBe('flag_added');
    expect(event?.userId).toBe('user-1');
    expect(event?.gameId).toBe('game-1');
    expect(event?.oldState).toEqual(oldState);
    expect(event?.newState).toEqual(newState);
    expect(event?.scheduledFireAt).toBe(COMPUTED_AT);
  });

  it('returns flag_added when old state is null and new state is flagged', () => {
    const event = diffFlagStates('user-1', null, flag(true, 2));
    expect(event?.type).toBe('flag_added');
    expect(event?.oldState).toBeNull();
  });

  it('returns flag_removed for flagged → unflagged', () => {
    const event = diffFlagStates('user-1', flag(true, 5), flag(false, 0));
    expect(event?.type).toBe('flag_removed');
  });

  it('returns priority_increased when priority rises by >= 3', () => {
    const event = diffFlagStates('user-1', flag(true, 2), flag(true, 5));
    expect(event?.type).toBe('priority_increased');
  });

  it('returns priority_decreased when priority drops by >= 3', () => {
    const event = diffFlagStates('user-1', flag(true, 7), flag(true, 4));
    expect(event?.type).toBe('priority_decreased');
  });

  it('returns null when priority changes by less than 3 (increase)', () => {
    expect(diffFlagStates('user-1', flag(true, 2), flag(true, 4))).toBeNull();
  });

  it('returns null when priority changes by less than 3 (decrease)', () => {
    expect(diffFlagStates('user-1', flag(true, 4), flag(true, 2))).toBeNull();
  });

  it('produces a stable, deterministic id for identical inputs', () => {
    const a = diffFlagStates('user-1', flag(false, 0), flag(true, 2));
    const b = diffFlagStates('user-1', flag(false, 0), flag(true, 2));
    expect(a?.id).toBeTruthy();
    expect(a?.id).toBe(b?.id);
  });

  it('produces different ids for different event types on the same game', () => {
    const added = diffFlagStates('user-1', flag(false, 0), flag(true, 2));
    const removed = diffFlagStates('user-1', flag(true, 5), flag(false, 0));
    expect(added?.id).not.toBe(removed?.id);
  });
});
