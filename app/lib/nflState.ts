/**
 * Client types + fetch for PLAN.md Section 9 `GET /state/nfl` (Sprint 10 Phase 1).
 * Home cold-start reads this first — it decides the display_phase branch before any games/flags fetch.
 */
import { apiClient } from './apiClient';

export type NflSeasonType = 'off' | 'pre' | 'regular' | 'post';

export interface NflStateResponse {
  season: string;
  week: number;
  /**
   * NOT FOR HOME DISPLAY — Sleeper passthrough; runs ahead of actual games. Engine/ingestion only.
   * Home keys off `display_phase`.
   */
  season_type: NflSeasonType;
  /**
   * UNTRUSTWORTHY FOR DISPLAY — Sleeper passthrough, phase-relative. Do not render in UI copy.
   * Use `preseason_start` / `regular_season_start` instead.
   */
  season_start_date: string | null;
  /** Date-only `YYYY-MM-DD` (America/New_York) from games, or null if underivable. */
  preseason_start: string | null;
  /** Date-only `YYYY-MM-DD` (America/New_York) from games, or null if underivable. */
  regular_season_start: string | null;
  /** Schedule-derived phase for Home (ET today vs openers). */
  display_phase: NflSeasonType;
}

export async function fetchNflState(): Promise<NflStateResponse> {
  return await apiClient.get<NflStateResponse>('/state/nfl');
}
