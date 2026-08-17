import { apiClient } from './apiClient';
import type { PlayerTeamMap, TeamRef } from './teamDisplay';

/** `GET /leagues` list entry (Section 9). */
export interface LeagueSummary {
  league_id: string;
  platform: string;
  name: string;
  sport: string;
  season_year: number;
  last_synced_at: string | null;
}

export interface LineupSlotPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string;
  team: TeamRef | null;
}

export const SLOT_TYPES = ['starter', 'bench', 'flex', 'idp'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export interface LineupSlot {
  slot_id: string;
  slot_type: SlotType;
  position_in_lineup: string;
  player: LineupSlotPlayer;
  is_star: boolean;
}

/** `GET /leagues/:id/lineup` response (Section 9). */
export interface LineupResponse {
  league_id: string;
  week: number;
  last_synced_at: string | null;
  slots: LineupSlot[];
}

export async function fetchLeagues(): Promise<LeagueSummary[]> {
  const { leagues } = await apiClient.get<{ leagues: LeagueSummary[] }>('/leagues');
  return leagues;
}

export async function fetchLineup(leagueId: string, week?: number): Promise<LineupResponse> {
  const query = week ? `?week=${week}` : '';
  return await apiClient.get<LineupResponse>(`/leagues/${leagueId}/lineup${query}`);
}

/** Fetches every league's current-week lineup in parallel. A single league failing to sync (e.g. a
 *  brand new Sleeper connection before its first sync completes) shouldn't take down the whole
 *  fetch — its lineup is just empty for this pass. */
export async function fetchAllLineups(
  leagues: LeagueSummary[],
  week?: number,
): Promise<LineupResponse[]> {
  const results = await Promise.all(
    leagues.map(async (league) => {
      try {
        return await fetchLineup(league.league_id, week);
      } catch (error) {
        console.warn(`[leagues] failed to load lineup for league ${league.league_id}`, error);
        return null;
      }
    }),
  );
  return results.filter((result): result is LineupResponse => result !== null);
}

/** Merges one or more lineups' `player.team` into a single `player_id -> team` map (Sprint 9 Phase 2
 *  — see `teamDisplay.ts`'s docstring for why this is the source of team affiliation for the reason
 *  chip and color flash, rather than a new server field). A player rostered in more than one league
 *  maps to the same team either way, so last-write-wins across leagues is safe. */
export function buildPlayerTeamMap(lineups: LineupResponse[]): PlayerTeamMap {
  const map: PlayerTeamMap = new Map();
  for (const lineup of lineups) {
    for (const slot of lineup.slots) {
      if (slot.player.team) {
        map.set(slot.player.player_id, slot.player.team);
      }
    }
  }
  return map;
}

export async function setStarPlayer(
  leagueId: string,
  week: number,
  playerId: string,
  isStar: boolean,
): Promise<{ week: number; player_id: string; is_star: boolean }> {
  return await apiClient.post(`/leagues/${leagueId}/stars`, {
    week,
    player_id: playerId,
    is_star: isStar,
  });
}

export async function syncLeague(leagueId: string): Promise<{ league_id: string; week: number; slot_count: number }> {
  return await apiClient.post(`/leagues/${leagueId}/sync`);
}

export async function disconnectLeague(leagueId: string): Promise<void> {
  await apiClient.delete(`/leagues/${leagueId}`);
}

export interface SleeperLeagueOption {
  league_id: string;
  name: string;
  season: string;
}

export async function fetchSleeperLeagues(username: string): Promise<SleeperLeagueOption[]> {
  const { leagues } = await apiClient.get<{ leagues: SleeperLeagueOption[] }>(
    `/sleeper/leagues?username=${encodeURIComponent(username)}`,
  );
  return leagues;
}

export async function connectSleeperLeague(
  sleeperUsername: string,
  leagueId: string,
): Promise<LeagueSummary> {
  return await apiClient.post('/leagues/sleeper', {
    sleeper_username: sleeperUsername,
    league_id: leagueId,
  });
}

export async function connectManualLeague(name: string, seasonYear: number): Promise<LeagueSummary> {
  return await apiClient.post('/leagues/manual', { name, season_year: seasonYear });
}

/** `PATCH /leagues/:id` — rename a manual league only (`manual_league_only` if Sleeper). */
export async function renameManualLeague(leagueId: string, name: string): Promise<LeagueSummary> {
  return await apiClient.patch(`/leagues/${leagueId}`, { name });
}

/** `PUT /leagues/:id/lineup` — replace the week’s slots for a manual league. */
export async function putManualLineup(
  leagueId: string,
  week: number,
  players: Array<{ player_id: string; position: string }>,
): Promise<LineupResponse> {
  return await apiClient.put(`/leagues/${leagueId}/lineup`, {
    week,
    slots: players.map((player) => ({
      player_id: player.player_id,
      slot_type: 'starter' as const,
      position_in_lineup: player.position,
    })),
  });
}
