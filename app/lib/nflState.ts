/**
 * Client types + fetch for PLAN.md Section 9 `GET /state/nfl` (Sprint 10 Phase 1).
 * Home cold-start reads this first — it decides the season_type branch before any games/flags fetch.
 */
import { apiClient } from './apiClient';

export type NflSeasonType = 'off' | 'pre' | 'regular' | 'post';

export interface NflStateResponse {
  season: string;
  week: number;
  season_type: NflSeasonType;
  /** ISO date `YYYY-MM-DD`, or null (expected in offseason — client falls back to season year). */
  season_start_date: string | null;
}

export async function fetchNflState(): Promise<NflStateResponse> {
  return await apiClient.get<NflStateResponse>('/state/nfl');
}
