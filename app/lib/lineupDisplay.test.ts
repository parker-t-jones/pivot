import { describe, expect, it } from 'vitest';

import type { LineupSlot } from './leagues';
import { formatPositionInLineup, sortLineupSlots } from './lineupDisplay';

function slot(
  positionInLineup: string,
  slotType: LineupSlot['slot_type'] = 'starter',
): LineupSlot {
  return {
    slot_id: positionInLineup,
    slot_type: slotType,
    position_in_lineup: positionInLineup,
    is_star: false,
    player: {
      player_id: positionInLineup,
      first_name: 'A',
      last_name: 'B',
      position: 'RB',
      team: null,
    },
  };
}

describe('formatPositionInLineup', () => {
  it('keeps ordinals and maps K/DEF to Sleeper-facing names', () => {
    expect(formatPositionInLineup('QB')).toBe('QB');
    expect(formatPositionInLineup('RB1')).toBe('RB1');
    expect(formatPositionInLineup('FLEX2')).toBe('FLEX2');
    expect(formatPositionInLineup('K')).toBe('KICKER');
    expect(formatPositionInLineup('DEF')).toBe('DEFENSE');
    expect(formatPositionInLineup('BN')).toBe('BENCH');
  });
});

describe('sortLineupSlots', () => {
  it('orders like a standard Sleeper roster (FantasyFocusApp shape)', () => {
    const scrambled = [
      slot('DEF'),
      slot('FLEX2', 'flex'),
      slot('RB2'),
      slot('WR1'),
      slot('K'),
      slot('TE'),
      slot('QB'),
      slot('FLEX1', 'flex'),
      slot('WR2'),
      slot('RB1'),
      slot('bn-a', 'bench'),
    ].map((row, index) =>
      row.slot_type === 'bench'
        ? { ...row, position_in_lineup: 'BN', slot_id: `bn-${index}` }
        : row,
    );

    expect(sortLineupSlots(scrambled).map((s) => s.position_in_lineup)).toEqual([
      'QB',
      'RB1',
      'RB2',
      'WR1',
      'WR2',
      'TE',
      'FLEX1',
      'FLEX2',
      'K',
      'DEF',
      'BN',
    ]);
  });
});
