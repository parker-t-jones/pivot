import type { Json } from './database.types.js';
import { FANTASY_CONDITION_TYPES, conditionTypeOf } from './pickRows.js';
import type { SupabaseServiceClient } from './supabase.js';

/** Free accounts: 3 picks a week. A parlay is one. Survivor and fantasy rows use none. */
export const FREE_BET_LIMIT = 3;

/** Free weekly slots. Survivor picks do not use one. Fantasy rows do not either. */
export function countsTowardFreeCap(condition: Json): boolean {
  const type = conditionTypeOf(condition);
  if (type === 'SURVIVOR') return false;
  return type === null || !FANTASY_CONDITION_TYPES.has(type);
}

export interface SlotRow {
  id: string;
  condition: Json;
  slip_id?: string | null;
}

/** The free slot a row uses: its slip for a parlay leg, itself otherwise. Null when it uses none. */
export function slotIdOf(row: SlotRow): string | null {
  if (!countsTowardFreeCap(row.condition)) return null;
  return row.slip_id ?? row.id;
}

export interface FreeSlotUse {
  /** Slots used this week: live slots plus spent ones (docs/P2-PICKS-MODEL.md §3). */
  used: number;
  /** Spent rows whose pick or slip is gone. */
  spent: number;
  liveSlotIds: Set<string>;
}

/**
 * Counts the week's slots from the week's `stakes` rows and its `stake_spent_slots`. A spent row
 * whose stake or slip still exists is skipped, so a delete that failed after its spent row was
 * written never counts twice.
 */
export function countFreeSlots(rows: readonly SlotRow[], spentIds: readonly string[]): FreeSlotUse {
  const liveSlotIds = new Set<string>();
  const liveIds = new Set<string>();
  for (const row of rows) {
    liveIds.add(row.id);
    if (row.slip_id) liveIds.add(row.slip_id);
    const slot = slotIdOf(row);
    if (slot !== null) liveSlotIds.add(slot);
  }
  const spent = new Set(spentIds.filter((id) => !liveIds.has(id))).size;
  return { used: liveSlotIds.size + spent, spent, liveSlotIds };
}

/** `stake_spent_slots` ids (stake or slip) for one user and week. */
export async function spentSlotIds(
  supabase: SupabaseServiceClient,
  userId: string,
  season: number,
  week: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('stake_spent_slots')
    .select('stake_id')
    .eq('user_id', userId)
    .eq('season', season)
    .eq('week', week);
  if (error) throw error;
  return ((data ?? []) as { stake_id: string }[]).map((row) => row.stake_id);
}
