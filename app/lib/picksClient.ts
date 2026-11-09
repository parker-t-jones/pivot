import type { StakeCondition } from '@pivot/shared/picks';

import { apiClient } from './apiClient';

/** A condition the app can add. Fantasy rows come from league sync, never from here. */
export type BetCondition = Exclude<
  StakeCondition,
  { type: 'ROSTERED' } | { type: 'OPPONENT_ROSTERED' }
>;

/** One pick in a `POST /picks` body (docs/P2-PICKS-MODEL.md §7). */
export interface PickInput {
  gameId: string;
  condition: BetCondition;
  teamId?: string;
  playerId?: string;
}

export interface PicksPageRow {
  id: string;
  game_id: string;
  slip_id: string | null;
  condition: { type: string };
}

/** The parts of `GET /picks` the entry flow reads. */
export interface PicksPage {
  week: number;
  free_limit: number;
  free_slots_used: number;
  picks: PicksPageRow[];
  slips: { id: string; legs: PicksPageRow[] }[];
}

export async function fetchPicks(week: number): Promise<PicksPage> {
  return await apiClient.get<PicksPage>(`/picks?week=${week}`);
}

export async function createPick(pick: PickInput): Promise<unknown> {
  return await apiClient.post('/picks', { pick });
}

export async function createSlip(legs: readonly PickInput[]): Promise<unknown> {
  return await apiClient.post('/picks', { legs });
}

/** Free picks left this week. Null for Pro, where the count is hidden. */
export function freePicksLeft(page: PicksPage, isPro: boolean): number | null {
  if (isPro) return null;
  return Math.max(0, page.free_limit - page.free_slots_used);
}
