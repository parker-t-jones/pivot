/**
 * Client types + fetch for PLAN.md Section 9 `GET /games?week=` and `GET /games/live` (Sprint 10).
 */
import { apiClient } from './apiClient';
import type { GameBroadcast } from './gameDisplay';

export interface ScheduleGame {
  game_id: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed' | string;
  scheduled_start: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
  home_team_primary_color: string;
  home_team_secondary_color: string;
  away_team_primary_color: string;
  away_team_secondary_color: string;
  broadcasts: GameBroadcast[];
}

export interface GamesWeekResponse {
  week: number;
  games: ScheduleGame[];
}

export interface LiveGame {
  game_id: string;
  status: 'in_progress';
  scheduled_start: string;
  home_team: string;
  away_team: string;
  home_team_name: string;
  away_team_name: string;
  home_team_primary_color: string;
  home_team_secondary_color: string;
  away_team_primary_color: string;
  away_team_secondary_color: string;
  score: { home: number; away: number };
  quarter: number;
  time_remaining_sec: number;
  possession_team: string | null;
  yards_to_endzone: number | null;
  down: number | null;
  distance: number | null;
  in_red_zone: boolean;
}

export interface GamesLiveResponse {
  games: LiveGame[];
}

export async function fetchGamesWeek(week: number): Promise<GamesWeekResponse> {
  return await apiClient.get<GamesWeekResponse>(`/games?week=${week}`);
}

export async function fetchGamesLive(): Promise<GamesLiveResponse> {
  return await apiClient.get<GamesLiveResponse>('/games/live');
}
