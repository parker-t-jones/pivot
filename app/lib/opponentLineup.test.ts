import { describe, expect, it } from 'vitest';

import { opponentSectionState } from './opponentLineup';

const opponent = { starters: [{ player_id: 'p-wr' }] };

describe('opponentSectionState', () => {
  it('hides the section when the response has no opponent', () => {
    expect(opponentSectionState(null, false)).toBe('hidden');
    expect(opponentSectionState(null, true)).toBe('hidden');
    expect(opponentSectionState(undefined, false)).toBe('hidden');
    expect(opponentSectionState(undefined, true)).toBe('hidden');
  });

  it('shows only the hint when watchOpponent is off', () => {
    expect(opponentSectionState(opponent, false)).toBe('off');
  });

  it('lists starters when watchOpponent is on', () => {
    expect(opponentSectionState(opponent, true)).toBe('on');
    expect(opponentSectionState({ starters: [] }, true)).toBe('on');
  });
});
