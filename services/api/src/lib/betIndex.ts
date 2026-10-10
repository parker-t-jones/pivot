import type { LineupCacheProvider } from '../cache/index.js';
import type { Json } from './database.types.js';
import type { SupabaseServiceClient } from './supabase.js';

const BET_CONDITION_TYPES = new Set([
  'SPREAD',
  'TOTAL_OVER',
  'TOTAL_UNDER',
  'MONEYLINE',
  'SURVIVOR',
]);

export function isBetCondition(condition: Json): boolean {
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) return false;
  const type = condition['type'];
  return typeof type === 'string' && BET_CONDITION_TYPES.has(type);
}

/** Indexes the user's current-week bet games and drops games they no longer have a bet on. */
export async function syncUserBetGames(
  deps: { supabase: SupabaseServiceClient; lineupCache: LineupCacheProvider },
  userId: string,
  season: number,
  week: number,
): Promise<void> {
  const { data, error } = await deps.supabase
    .from('stakes')
    .select('game_id, condition')
    .eq('user_id', userId)
    .eq('season', season)
    .eq('week', week);
  if (error) throw new Error(error.message);

  const next = new Set<string>();
  for (const row of data ?? []) {
    if (!isBetCondition(row.condition)) continue;
    next.add(row.game_id);
  }

  const previous = new Set(await deps.lineupCache.getUserBetGames(userId, week));
  for (const gameId of previous) {
    if (!next.has(gameId)) await deps.lineupCache.removeUserBet(gameId, userId, week);
  }
  for (const gameId of next) {
    await deps.lineupCache.addUserBet(gameId, userId, week);
  }
}
