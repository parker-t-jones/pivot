import { ApiError } from '../lib/errors.js';

const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  roster_positions: string[];
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  /** Present on `/rosters` — same shape as matchup starters/players; used for offseason fallback. */
  starters: string[];
  players: string[];
}

export interface SleeperMatchup {
  roster_id: number;
  starters: string[];
  players: string[];
}

export type SleeperSeasonType = 'pre' | 'regular' | 'post' | 'off';

export interface SleeperNflState {
  week: number;
  season: string;
  previous_season: string;
  season_type: SleeperSeasonType;
  /** Present when Sleeper publishes it; often missing/unreliable in the offseason. */
  season_start_date?: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${SLEEPER_BASE_URL}${path}`);
  if (!response.ok) {
    throw new ApiError(
      502,
      'sleeper_api_error',
      `Sleeper API request to ${path} failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

/** Thin, typed wrapper over the handful of Sleeper endpoints Sprint 3 needs. */
export const sleeperClient = {
  async getUserByUsername(username: string): Promise<SleeperUser | null> {
    return await getJson<SleeperUser | null>(`/user/${encodeURIComponent(username)}`);
  },

  async getUserLeagues(userId: string, season: string): Promise<SleeperLeague[]> {
    return await getJson<SleeperLeague[]>(
      `/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
    );
  },

  async getLeague(leagueId: string): Promise<SleeperLeague> {
    return await getJson<SleeperLeague>(`/league/${encodeURIComponent(leagueId)}`);
  },

  async getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
    return await getJson<SleeperRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`);
  },

  async getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
    return await getJson<SleeperMatchup[]>(
      `/league/${encodeURIComponent(leagueId)}/matchups/${week}`,
    );
  },

  async getNflState(): Promise<SleeperNflState> {
    return await getJson<SleeperNflState>('/state/nfl');
  },
};
