import type { StakeCondition } from '@pivot/shared/picks';

import { apiClient } from './apiClient';
import { isParlay, type ManualStake, type StakesResponse } from './stakes';
import { deleteStake, deleteStakeKeepalive } from './stakesClient';
import { watchPicksResponse, type PicksApiResponse } from './watchPicks';

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

export interface RecapPickSummary {
  id: string;
  label: string;
  result: 'won' | 'lost' | 'tie' | 'void';
  result_value: number | null;
  game_id: string;
}

/** `GET /picks/recap` (docs/P2-PICKS-MODEL.md §5, issue #47). */
export interface RecapPage {
  week: number;
  season: number | null;
  week_recap: {
    picks_made: number;
    won: number;
    lost: number;
    tie: number;
    void: number;
    decided: number;
    hit_rate: number | null;
    best: RecapPickSummary | null;
    worst: RecapPickSummary | null;
  };
  season_recap: {
    won: number;
    decided: number;
    hit_rate: number | null;
  };
}

export async function fetchRecap(week?: number): Promise<RecapPage> {
  return await apiClient.get<RecapPage>(
    week === undefined ? '/picks/recap' : `/picks/recap?week=${week}`,
  );
}

export async function createPick(pick: PickInput): Promise<unknown> {
  return await apiClient.post('/picks', { pick });
}

export async function createSlip(legs: readonly PickInput[]): Promise<unknown> {
  return await apiClient.post('/picks', { legs });
}

/** Free bet legs left this week. Null for Pro, where the count is hidden. */
export function freePicksLeft(page: PicksPage, isPro: boolean): number | null {
  if (isPro) return null;
  return Math.max(0, page.free_limit - page.free_slots_used);
}

/** The Watchlist and Home read of `GET /picks`, shaped like `GET /stakes` (see `watchPicks`). */
export async function fetchWatchPicks(week: number): Promise<StakesResponse> {
  return watchPicksResponse(await apiClient.get<PicksApiResponse>(`/picks?week=${week}`));
}

export async function deleteSlip(id: string): Promise<void> {
  await apiClient.delete(`/picks/slips/${id}`);
}

/** A single pick is removed with `DELETE /stakes/:id`, a parlay with `DELETE /picks/slips/:id`. */
export async function deleteWatchPick(stake: ManualStake): Promise<void> {
  if (isParlay(stake)) {
    await deleteSlip(stake.id);
    return;
  }
  await deleteStake(stake.id);
}

/** Tab-close delete for either kind of row. See `deleteStakeKeepalive`. */
export function deleteWatchPickKeepalive(stake: ManualStake, accessToken: string): void {
  if (!isParlay(stake)) {
    deleteStakeKeepalive(stake.id, accessToken);
    return;
  }
  const base = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!base || accessToken.length === 0) return;
  void fetch(`${base}/picks/slips/${stake.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: true,
  });
}
