import type { LineupCacheProvider } from '../cache/index.js';
import type { Json } from './database.types.js';
import { conditionTypeOf, isBetConditionType } from './pickRows.js';
import type { SupabaseServiceClient } from './supabase.js';

/** Every manual pick, props and parlay legs included. Only fantasy rows are not bets. */
export function isBetCondition(condition: Json): boolean {
  return isBetConditionType(conditionTypeOf(condition));
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
