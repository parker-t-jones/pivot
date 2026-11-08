import type { PropPlayer } from '@pivot/engine';
import type { SupabaseServiceClient } from './supabase.js';

interface PlayerRow {
  id: string;
  team_id: string;
  position: string;
  espn_id: string | null;
  first_name: string;
  last_name: string;
}

export function toPropPlayer(row: PlayerRow): PropPlayer {
  return {
    playerId: row.id,
    teamId: row.team_id,
    // Same mapping as the lineup cache: DEF is defense, every other position is offense.
    unit: row.position === 'DEF' ? 'defense' : 'offense',
    espnId: row.espn_id,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

/** Players for PLAYER-subject picks, by `players.id`. */
export async function loadPropPlayers(
  supabase: SupabaseServiceClient,
  playerIds: readonly string[],
): Promise<Map<string, PropPlayer>> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('players')
    .select('id, team_id, position, espn_id, first_name, last_name')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as PlayerRow[]).map((row) => [row.id, toPropPlayer(row)]));
}
