import type { Json } from './database.types.js';
import { FANTASY_CONDITION_TYPES, conditionTypeOf } from './pickRows.js';
import type { SupabaseServiceClient } from './supabase.js';

/** Free accounts: 3 bet legs a week. Each single and each parlay leg uses one. Survivor and fantasy rows use none. */
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

/** The free slot a row uses: its own id, including each parlay leg. Null when it uses none. */
export function slotIdOf(row: SlotRow): string | null {
  if (!countsTowardFreeCap(row.condition)) return null;
  return row.id;
}

export interface FreeSlotUse {
  /** Slots used this week: live slots plus spent ones (docs/P2-PICKS-MODEL.md §3). */
  used: number;
  /** Spent legs whose pick or slip is gone. */
  spent: number;
  liveSlotIds: Set<string>;
}

/**
 * Counts the week's slots from the week's `stakes` rows and its `stake_spent_slots`. A spent row
 * whose stake or slip still exists is skipped, so a delete that failed after its spent row was
 * written never counts twice.
 */
export function countFreeSlots(
  rows: readonly SlotRow[],
  spentRows: readonly { stake_id: string; slots: number }[],
): FreeSlotUse {
  const liveSlotIds = new Set<string>();
  const liveIds = new Set<string>();
  for (const row of rows) {
    liveIds.add(row.id);
    if (row.slip_id) liveIds.add(row.slip_id);
    const slot = slotIdOf(row);
    if (slot !== null) liveSlotIds.add(slot);
  }
  const spent = spentRows.reduce(
    (sum, row) => sum + (liveIds.has(row.stake_id) ? 0 : row.slots),
    0,
  );
  return { used: liveSlotIds.size + spent, spent, liveSlotIds };
}

/** Spent stake or slip ids and their leg counts for one user and week. */
export async function spentSlotRows(
  supabase: SupabaseServiceClient,
  userId: string,
  season: number,
  week: number,
): Promise<{ stake_id: string; slots: number }[]> {
  const { data, error } = await supabase
    .from('stake_spent_slots')
    .select('stake_id, slots')
    .eq('user_id', userId)
    .eq('season', season)
    .eq('week', week);
  if (error) throw error;
  return (data ?? []) as { stake_id: string; slots: number }[];
}
