import { apiClient } from './apiClient';

export interface GameLink {
  game_id: string;
  url: string;
  host: string;
  updated_at: string;
}

export interface GameLinksResponse {
  week: number;
  links: GameLink[];
}

/** Saved stream URLs for one NFL week. `GET /game-links?week`. */
export async function fetchGameLinks(week: number): Promise<GameLinksResponse> {
  return await apiClient.get<GameLinksResponse>(`/game-links?week=${week}`);
}

/** Upsert the signed-in user's link for one game. `PUT /game-links/:gameId`. */
export async function saveGameLink(gameId: string, url: string): Promise<GameLink> {
  return await apiClient.put<GameLink>(`/game-links/${gameId}`, { url });
}

/** Delete the signed-in user's link. `DELETE /game-links/:gameId` is 204. */
export async function deleteGameLink(gameId: string): Promise<void> {
  await apiClient.delete(`/game-links/${gameId}`);
}
