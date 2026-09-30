import { describe, expect, it } from 'vitest';

import type { LineupSlot } from './leagues';
import { orderLineupSlots, slotLabel } from './lineupOrder';

function row(
  positionInLineup: string,
  playerId: string,
  slotType: LineupSlot['slot_type'] = 'starter',
  isStar = false,
): LineupSlot {
  return {
    slot_id: playerId,
    slot_type: slotType,
    position_in_lineup: positionInLineup,
    is_star: isStar,
    player: {
      player_id: playerId,
      first_name: 'A',
      last_name: 'B',
      position: 'RB',
      team: null,
    },
  };
}

function ids(slots: readonly LineupSlot[]): string[] {
  return slots.map((slot) => slot.player.player_id);
}

/** Mixed Sleeper-shaped roster, including tied BN rows and an IR row. */
const MIXED: LineupSlot[] = [
  row('BN', 'bn-m', 'bench'),
  row('DEFENSE', 'def'),
  row('RB2', 'rb2'),
  row('FLEX2', 'flex2', 'flex'),
  row('QB', 'qb'),
  row('IR', 'ir', 'bench'),
  row('RB1', 'rb1'),
  row('WR1', 'wr1'),
  row('TE', 'te'),
  row('FLEX1', 'flex1', 'flex'),
  row('KICKER', 'k'),
  row('SUPER_FLEX', 'sf', 'flex'),
  row('BN', 'bn-a', 'bench'),
  row('ZZ_SLOT', 'unk-z'),
  row('AA_SLOT', 'unk-a'),
  row('WRRB_FLEX', 'wrrb', 'flex'),
  row('REC_FLEX', 'rec', 'flex'),
  row('RB10', 'rb10'),
];

const MIXED_ORDER = [
  'qb',
  'rb1',
  'rb2',
  'rb10',
  'wr1',
  'te',
  'flex1',
  'flex2',
  'sf',
  'wrrb',
  'rec',
  'k',
  'def',
  'unk-a',
  'unk-z',
  'bn-a',
  'bn-m',
  'ir',
];

describe('orderLineupSlots', () => {
  it('returns the same order for shuffled input', () => {
    const shuffles = [
      [...MIXED].reverse(),
      [...MIXED.slice(8), ...MIXED.slice(0, 8)],
      MIXED.filter((_, index) => index % 2 === 0).concat(
        MIXED.filter((_, index) => index % 2 === 1),
      ),
    ];
    expect(shuffles.length).toBeGreaterThanOrEqual(3);
    for (const shuffled of shuffles) {
      expect(ids(orderLineupSlots(shuffled))).toEqual(MIXED_ORDER);
    }
  });

  it('ignores starred flags', () => {
    const starred = MIXED.map((slot, index) => ({ ...slot, is_star: index % 2 === 0 }));
    const flipped = MIXED.map((slot, index) => ({ ...slot, is_star: index % 2 !== 0 }));
    expect(ids(orderLineupSlots(starred))).toEqual(MIXED_ORDER);
    expect(ids(orderLineupSlots(flipped))).toEqual(MIXED_ORDER);
  });

  it('orders numeric suffixes numerically within a slot type', () => {
    const slots = [
      row('RB2', 'rb2'),
      row('FLEX2', 'flex2', 'flex'),
      row('RB10', 'rb10'),
      row('RB1', 'rb1'),
      row('FLEX1', 'flex1', 'flex'),
    ];
    expect(ids(orderLineupSlots(slots))).toEqual(['rb1', 'rb2', 'rb10', 'flex1', 'flex2']);
  });

  it('tie-breaks identical slots by player id', () => {
    const slots = [
      row('RB', 'player-b'),
      row('RB', 'player-a'),
      row('BN', 'bn-2', 'bench'),
      row('BN', 'bn-1', 'bench'),
    ];
    expect(ids(orderLineupSlots([...slots].reverse()))).toEqual(['player-a', 'player-b', 'bn-1', 'bn-2']);
  });
});

describe('slotLabel', () => {
  it('maps known slots and strips numeric suffixes', () => {
    expect(slotLabel('QB')).toBe('QB');
    expect(slotLabel('RB1')).toBe('RB');
    expect(slotLabel('WR')).toBe('WR');
    expect(slotLabel('TE')).toBe('TE');
    expect(slotLabel('FLEX1')).toBe('FLEX');
    expect(slotLabel('SUPER_FLEX')).toBe('SF');
    expect(slotLabel('KICKER')).toBe('K');
    expect(slotLabel('K')).toBe('K');
    expect(slotLabel('DEFENSE')).toBe('DEF');
    expect(slotLabel('DEF')).toBe('DEF');
  });

  it('passes unknown values through uppercased', () => {
    expect(slotLabel('idp')).toBe('IDP');
    expect(slotLabel('WRRB_FLEX')).toBe('WRRB_FLEX');
    expect(slotLabel('REC_FLEX')).toBe('REC_FLEX');
  });
});
