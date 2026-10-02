import { describe, expect, it } from 'vitest';
import type { FlagState } from '@pivot/shared';
import { diffFlagStates } from './diffFlagStates.js';

const COMPUTED_AT = 1_700_000_000_000;

function flag(
  flagged: boolean,
  priorityScore: number,
  reasons: FlagState['reasons'] = [],
): FlagState {
  return { gameId: 'game-1', flagged, priorityScore, reasons, computedAt: COMPUTED_AT };
}

const offense = (ids: string[]): FlagState['reasons'] => [
  { type: 'offense_active', triggeringPlayerIds: ids },
];
const defense = (ids: string[]): FlagState['reasons'] => [
  { type: 'defense_active', triggeringPlayerIds: ids },
];

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

  it('returns null when priority changes by less than 3 and the reasons are unchanged', () => {
    expect(diffFlagStates('user-1', flag(true, 2), flag(true, 4))).toBeNull();
    expect(
      diffFlagStates('user-1', flag(true, 2, offense(['te'])), flag(true, 4, offense(['te']))),
    ).toBeNull();
  });

  it('returns flag_added when defense flips to offense, even if priority does not move', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, defense(['dst'])),
      flag(true, 2, offense(['te'])),
    );
    expect(event?.type).toBe('flag_added');
    expect(event?.newState.reasons).toEqual(offense(['te']));
  });

  it('returns flag_added when offense flips to defense', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, offense(['te'])),
      flag(true, 2, defense(['dst'])),
    );
    expect(event?.type).toBe('flag_added');
    expect(event?.newState.reasons).toEqual(defense(['dst']));
  });

  it('returns flag_added when a second player joins an existing reason inside the ±3 band', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, offense(['rb'])),
      flag(true, 4, offense(['rb', 'wr'])),
    );
    expect(event?.type).toBe('flag_added');
    expect(event?.newState.reasons).toEqual(offense(['rb', 'wr']));
  });

  it('returns flag_added when the side changes even if priority also crosses ±3', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, defense(['dst'])),
      flag(true, 7, offense(['te'])),
    );
    expect(event?.type).toBe('flag_added');
  });

  it('returns priority_increased when red zone is entered with the same side and players', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, offense(['te'])),
      flag(true, 5, [...offense(['te']), { type: 'red_zone', triggeringPlayerIds: [] }]),
    );
    expect(event?.type).toBe('priority_increased');
  });

  it('returns null when close game is added and priority rises by 2', () => {
    expect(
      diffFlagStates(
        'user-1',
        flag(true, 2, offense(['te'])),
        flag(true, 4, [...offense(['te']), { type: 'close_game', triggeringPlayerIds: [] }]),
      ),
    ).toBeNull();
  });

  it('returns priority_decreased when red zone is left and priority drops by 3', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 5, [...offense(['te']), { type: 'red_zone', triggeringPlayerIds: [] }]),
      flag(true, 2, offense(['te'])),
    );
    expect(event?.type).toBe('priority_decreased');
  });

  it('returns priority_increased when a star bonus is added and the side and players stay', () => {
    const event = diffFlagStates(
      'user-1',
      flag(true, 2, offense(['te'])),
      flag(true, 7, [
        ...offense(['te']),
        { type: 'star_player_active', triggeringPlayerIds: ['te'] },
      ]),
    );
    expect(event?.type).toBe('priority_increased');
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
