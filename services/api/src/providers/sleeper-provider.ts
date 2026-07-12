import type { LeaguePlatform } from '@fantasy-focus/shared';
import { ApiError } from '../lib/errors.js';
import type {
  FantasyProvider,
  FetchLineupInput,
  NormalizedLineupSlot,
} from './fantasy-provider.js';
import { mapRosterToLineupSlots } from './roster-mapping.js';
import { sleeperClient } from './sleeper-client.js';

export interface SleeperLeagueConnection {
  externalLeagueId: string;
  externalOwnerId: string;
  externalRosterId: string;
  name: string;
  seasonYear: number;
}

/**
 * `SleeperProvider` (PLAN.md Section 2 swap-ready `FantasyProvider` boundary).
 *
 * `resolveLeagueConnection` is Sleeper-specific (username → user_id → owned roster) and lives
 * here rather than on the shared `FantasyProvider` interface — "connect" request/response
 * shapes are inherently per-platform (Section 9 `POST /leagues/sleeper` vs `POST /leagues/manual`).
 */
export class SleeperProvider implements FantasyProvider {
  readonly platform: LeaguePlatform = 'sleeper';

  supportsSync(): boolean {
    return true;
  }

  async resolveLeagueConnection(
    sleeperUsername: string,
    leagueId: string,
  ): Promise<SleeperLeagueConnection> {
    const user = await sleeperClient.getUserByUsername(sleeperUsername);
    if (!user) {
      throw new ApiError(
        404,
        'sleeper_user_not_found',
        `No Sleeper user found for username "${sleeperUsername}".`,
      );
    }

    const [league, rosters] = await Promise.all([
      sleeperClient.getLeague(leagueId),
      sleeperClient.getLeagueRosters(leagueId),
    ]);

    const roster = rosters.find((r) => r.owner_id === user.user_id);
    if (!roster) {
      throw new ApiError(
        404,
        'sleeper_roster_not_found',
        `Sleeper user "${sleeperUsername}" does not own a roster in league ${leagueId}.`,
      );
    }

    return {
      externalLeagueId: league.league_id,
      externalOwnerId: user.user_id,
      externalRosterId: String(roster.roster_id),
      name: league.name,
      seasonYear: Number(league.season),
    };
  }

  async fetchLineup(input: FetchLineupInput): Promise<NormalizedLineupSlot[]> {
    const [league, matchups] = await Promise.all([
      sleeperClient.getLeague(input.externalLeagueId),
      sleeperClient.getLeagueMatchups(input.externalLeagueId, input.week),
    ]);

    const matchup = matchups.find((m) => String(m.roster_id) === input.externalRosterId);
    if (!matchup) {
      throw new ApiError(
        404,
        'sleeper_matchup_not_found',
        `No matchup found for roster ${input.externalRosterId} in week ${input.week}.`,
      );
    }

    return mapRosterToLineupSlots(league.roster_positions, matchup.starters, matchup.players);
  }
}
