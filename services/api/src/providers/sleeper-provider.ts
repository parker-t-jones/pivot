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
    const league = await sleeperClient.getLeague(input.externalLeagueId);

    // Primary path: week matchups (accurate during the season). When matchups are missing —
    // offseason/preseason week 0, empty array, no matching roster, or a not-found-style error —
    // fall through to the league roster, which carries the same starters/players fields.
    const matchupSlots = await tryLineupFromMatchups(
      input.externalLeagueId,
      input.externalRosterId,
      input.week,
      league.roster_positions,
    );
    if (matchupSlots) {
      return matchupSlots;
    }

    const rosters = await sleeperClient.getLeagueRosters(input.externalLeagueId);
    const roster = rosters.find((r) => String(r.roster_id) === input.externalRosterId);
    if (!roster) {
      throw new ApiError(
        404,
        'sleeper_roster_not_found',
        `No roster found for roster ${input.externalRosterId} in league ${input.externalLeagueId}.`,
      );
    }

    return mapRosterToLineupSlots(
      league.roster_positions,
      roster.starters ?? [],
      roster.players ?? [],
    );
  }
}

/**
 * Returns mapped slots when a matching week matchup exists; `null` when matchups are unavailable
 * or don't include this roster (caller should fall back to `/rosters`).
 */
async function tryLineupFromMatchups(
  externalLeagueId: string,
  externalRosterId: string,
  week: number,
  rosterPositions: string[],
): Promise<NormalizedLineupSlot[] | null> {
  let matchups: Awaited<ReturnType<typeof sleeperClient.getLeagueMatchups>>;
  try {
    matchups = await sleeperClient.getLeagueMatchups(externalLeagueId, week);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }

  if (!Array.isArray(matchups) || matchups.length === 0) {
    return null;
  }

  const matchup = matchups.find((m) => String(m.roster_id) === externalRosterId);
  if (!matchup) {
    return null;
  }

  return mapRosterToLineupSlots(rosterPositions, matchup.starters, matchup.players);
}
