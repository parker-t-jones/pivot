import type { SupabaseServiceClient } from './supabase.js';

/** One read of `prime_event_gti` for the games in a request. Empty when none of them have a row. */
export async function loadPrimeGtis(
  supabase: SupabaseServiceClient,
  gameIds: readonly string[],
): Promise<Map<string, string>> {
  if (gameIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('prime_event_gti')
    .select('game_id, gti')
    .in('game_id', [...gameIds]);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.game_id, row.gti);
  }
  return map;
}
