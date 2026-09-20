import { parsePreferences, FREE_MAX_WATCHED_LEAGUES, type Preferences } from '@pivot/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolves which league IDs the user is watching, applying free-tier clamp and
 * auto-fill when the list is empty but leagues exist.
 */
export function resolveWatchedLeagueIds(input: {
  preferences: Preferences;
  subscriptionTier: string;
  ownedLeagueIds: string[];
}): string[] {
  const owned = new Set(input.ownedLeagueIds);
  let watched = input.preferences.watchedLeagueIds.filter((id) => owned.has(id));

  if (watched.length === 0 && input.ownedLeagueIds.length > 0) {
    watched = [input.ownedLeagueIds[0]!];
  }

  if (input.subscriptionTier !== 'pro' && watched.length > FREE_MAX_WATCHED_LEAGUES) {
    watched = watched.slice(0, FREE_MAX_WATCHED_LEAGUES);
  }

  return watched;
}

/** Persist preferences.watchedLeagueIds after connect / disconnect / clamp. */
export async function updateWatchedLeagueIds(
  supabase: SupabaseClient,
  userId: string,
  nextIds: string[],
): Promise<Preferences> {
  const { data: row, error } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', userId)
    .single();
  if (error) throw error;

  const current = parsePreferences(row.preferences);
  const merged = parsePreferences({
    ...current,
    watchedLeagueIds: nextIds,
  });

  const { error: updateError } = await supabase
    .from('users')
    .update({ preferences: merged })
    .eq('id', userId);
  if (updateError) throw updateError;

  return merged;
}

/**
 * After connecting a league: ensure it is watched when free (replace) or add when Pro empty/auto.
 * Free: always set watched to [newLeagueId] if nothing valid, or keep existing single watch;
 *   if free and new connect and watched empty → watch new. If free and already watching another,
 *   leave as-is (user picks Active Lineup). First league ever → watch it.
 */
export async function onLeagueConnected(
  supabase: SupabaseClient,
  userId: string,
  leagueId: string,
  subscriptionTier: string,
): Promise<void> {
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ownedIds = (leagues ?? []).map((l) => l.id);
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', userId)
    .single();
  if (userError) throw userError;

  const prefs = parsePreferences(userRow.preferences);
  let watched = prefs.watchedLeagueIds.filter((id) => ownedIds.includes(id));

  if (watched.length === 0) {
    watched = [leagueId];
  } else if (subscriptionTier === 'pro' && !watched.includes(leagueId) && ownedIds.length === 1) {
    watched = [leagueId];
  }

  if (subscriptionTier !== 'pro') {
    watched = watched.slice(0, FREE_MAX_WATCHED_LEAGUES);
    if (watched.length === 0) watched = [leagueId];
  }

  await updateWatchedLeagueIds(supabase, userId, watched);
}

/** After disconnect: drop the id; if empty, watch the oldest remaining league. */
export async function onLeagueDisconnected(
  supabase: SupabaseClient,
  userId: string,
  removedLeagueId: string,
): Promise<void> {
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ownedIds = (leagues ?? []).map((l) => l.id);
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('preferences, subscription_tier')
    .eq('id', userId)
    .single();
  if (userError) throw userError;

  const prefs = parsePreferences(userRow.preferences);
  let watched = prefs.watchedLeagueIds.filter(
    (id) => id !== removedLeagueId && ownedIds.includes(id),
  );

  if (watched.length === 0 && ownedIds.length > 0) {
    watched = [ownedIds[0]!];
  }

  if (userRow.subscription_tier !== 'pro') {
    watched = watched.slice(0, FREE_MAX_WATCHED_LEAGUES);
  }

  await updateWatchedLeagueIds(supabase, userId, watched);
}
