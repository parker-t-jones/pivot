import type { SupabaseServiceClient } from './supabase.js';

/** The league columns the carry reads. `manual_lineup_week` is null until a lineup is saved. */
export interface CarryLeague {
  id: string;
  platform: string;
  manual_lineup_week: number | null;
}

/**
 * Manual lineups are stored per week in `lineup_slots`. When `week` is past the league's
 * `manual_lineup_week`, copy that week's slots (stars included) into `week` and advance the
 * column, so the lineup persists across weeks. Each player's game for the new week comes from
 * the ROSTERED stake write-through, which maps players by team (a bye gets no stake).
 *
 * A saved empty lineup copies nothing but still advances the week, so it stays empty. A week that
 * already has slots is left alone. Sleeper leagues and earlier weeks are never touched.
 * Returns true when it copied any slots.
 */
export async function carryManualLineupForward(
  supabase: SupabaseServiceClient,
  league: CarryLeague,
  week: number,
): Promise<boolean> {
  if (league.platform !== 'manual') return false;
  const from = league.manual_lineup_week;
  if (from === null || from >= week) return false;

  const { data: target, error: targetError } = await supabase
    .from('lineup_slots')
    .select('player_id')
    .eq('league_id', league.id)
    .eq('week', week);
  if (targetError) throw targetError;

  let copied = false;
  if ((target ?? []).length === 0) {
    const { data: source, error: sourceError } = await supabase
      .from('lineup_slots')
      .select('player_id, slot_type, position_in_lineup, is_star')
      .eq('league_id', league.id)
      .eq('week', from);
    if (sourceError) throw sourceError;

    const rows = (source ?? []).map((slot) => ({
      league_id: league.id,
      week,
      player_id: slot.player_id,
      slot_type: slot.slot_type,
      position_in_lineup: slot.position_in_lineup,
      is_star: slot.is_star,
    }));
    if (rows.length > 0) {
      // Two requests can carry the same week at once; the unique key keeps one copy.
      const { error: insertError } = await supabase
        .from('lineup_slots')
        .upsert(rows, { onConflict: 'league_id,week,player_id', ignoreDuplicates: true });
      if (insertError) throw insertError;
      copied = true;
    }
  }

  await markManualLineupWeek(supabase, league, week);
  return copied;
}

/** Record `week` as the league's latest manual lineup week. Never moves it backward. */
export async function markManualLineupWeek(
  supabase: SupabaseServiceClient,
  league: CarryLeague,
  week: number,
): Promise<void> {
  if (league.platform !== 'manual') return;
  if (league.manual_lineup_week !== null && league.manual_lineup_week >= week) return;
  const { error } = await supabase
    .from('leagues')
    .update({ manual_lineup_week: week })
    .eq('id', league.id);
  if (error) throw error;
  league.manual_lineup_week = week;
}
