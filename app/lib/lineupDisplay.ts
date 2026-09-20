import type { LineupSlot } from './leagues';

/**
 * Display label for `position_in_lineup` — keeps Sleeper ordinals (RB1, FLEX2) and
 * maps terse API codes to the names users see in Sleeper (Kicker / Defense).
 */
export function formatPositionInLineup(positionInLineup: string): string {
  const match = /^([A-Za-z_]+)(\d+)?$/.exec(positionInLineup);
  if (!match) return positionInLineup;

  const base = match[1]!.toUpperCase();
  const ordinal = match[2] ?? '';
  const pretty = SLOT_BASE_LABELS[base] ?? base;
  return `${pretty}${ordinal}`;
}

/**
 * Sort starters/flex into Sleeper roster order (QB → RBs → WRs → TE → FLEX… → K → DEF),
 * then bench. Within a base position, ordinals ascend (RB1 before RB2).
 *
 * Used because `GET /leagues/:id/lineup` orders by `created_at`, which can drift after upserts.
 */
export function sortLineupSlots(slots: readonly LineupSlot[]): LineupSlot[] {
  return [...slots].sort((a, b) => compareLineupSlots(a, b));
}

export function compareLineupSlots(a: LineupSlot, b: LineupSlot): number {
  const aKey = slotSortKey(a);
  const bKey = slotSortKey(b);
  if (aKey.family !== bKey.family) return aKey.family - bKey.family;
  if (aKey.ordinal !== bKey.ordinal) return aKey.ordinal - bKey.ordinal;
  return a.position_in_lineup.localeCompare(b.position_in_lineup);
}

const SLOT_BASE_LABELS: Record<string, string> = {
  K: 'KICKER',
  DEF: 'DEFENSE',
  FLEX: 'FLEX',
  SUPER_FLEX: 'SUPER FLEX',
  WRRB_FLEX: 'WR/RB FLEX',
  REC_FLEX: 'REC FLEX',
  BN: 'BENCH',
};

/** Matches typical Sleeper `roster_positions` order for v1-allowed slots. */
const SLOT_FAMILY_RANK: Record<string, number> = {
  QB: 10,
  SUPER_FLEX: 15,
  RB: 20,
  WR: 30,
  TE: 40,
  FLEX: 50,
  WRRB_FLEX: 51,
  REC_FLEX: 52,
  K: 60,
  DEF: 70,
  BN: 100,
};

function slotSortKey(slot: LineupSlot): { family: number; ordinal: number } {
  if (slot.slot_type === 'bench') {
    return { family: SLOT_FAMILY_RANK.BN ?? 100, ordinal: 0 };
  }

  const match = /^([A-Za-z_]+)(\d+)?$/.exec(slot.position_in_lineup);
  const base = (match?.[1] ?? slot.position_in_lineup).toUpperCase();
  const ordinal = match?.[2] ? Number.parseInt(match[2], 10) : 0;
  const family = SLOT_FAMILY_RANK[base] ?? 90;
  return { family, ordinal };
}
