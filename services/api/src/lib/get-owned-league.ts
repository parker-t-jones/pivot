import type { SupabaseServiceClient } from './supabase.js';
import { ApiError } from './errors.js';

/**
 * Loads a league and verifies it belongs to `userId`. Routes use the service-role Supabase
 * client (bypasses RLS), so this ownership check has to happen explicitly (`plugins/auth.ts`
 * only tells us who the caller is).
 */
export async function getOwnedLeagueOrThrow(
  supabase: SupabaseServiceClient,
  userId: string,
  leagueId: string,
) {
  const { data, error } = await supabase.from('leagues').select('*').eq('id', leagueId).single();
  if (error || !data) {
    throw new ApiError(404, 'league_not_found', `No league found with id "${leagueId}".`);
  }
  if (data.user_id !== userId) {
    throw new ApiError(404, 'league_not_found', `No league found with id "${leagueId}".`);
  }
  return data;
}
