import { apiClient } from './apiClient';
import type { TeamRef } from './teamDisplay';

export interface PlayerSearchResult {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: TeamRef | null;
}

/** `GET /players/search?q={q}` (Section 9) — used by the manual-lineup builder (onboarding step 3 /
 *  Settings "Add manually"). */
export async function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
  if (query.trim().length === 0) return [];
  const { players } = await apiClient.get<{ players: PlayerSearchResult[] }>(
    `/players/search?q=${encodeURIComponent(query.trim())}`,
  );
  return players;
}
