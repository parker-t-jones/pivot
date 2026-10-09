import type { LeaguePlatform } from '@pivot/shared';
import { ApiError } from '../lib/errors.js';
import type {
  FantasyProvider,
  FetchedLineup,
  FetchLineupInput,
  FetchRosterPlayersInput,
  NormalizedLineupSlot,
} from './fantasy-provider.js';
import { opponentSlotsFrom } from './opponentSlots.js';
import { mapRosterToLineupSlots } from './roster-mapping.js';
import { sleeperClient, type SleeperMatchup, type SleeperRoster } from './sleeper-client.js';

export interface SleeperLeagueConnection {
  externalLeagueId: string;
  externalOwnerId: string;
  externalRosterId: string;
  name: string;
  seasonYear: number;
}

const EMPTY_SLOT_PLAYER_ID = '0';

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

  /**
   * Week-scoped matchup lineup. Still opportunistically falls back to `/rosters` when matchups
   * are empty/missing — safety net if `display_phase` and Sleeper briefly disagree during the
   * active season. Off/pre sync must call `fetchRosterPlayers` instead (gated in lineup-sync).
   */
  async fetchLineup(input: FetchLineupInput): Promise<FetchedLineup> {
    const league = await sleeperClient.getLeague(input.externalLeagueId);
    const matchups = await loadMatchups(input.externalLeagueId, input.week);
    const matchupSlots = slotsFromMatchup(
      matchups,
      input.externalRosterId,
      league.roster_positions,
    );

    let rosters: SleeperRoster[] | undefined;
    let slots: NormalizedLineupSlot[];
    if (matchupSlots) {
      slots = matchupSlots;
    } else {
      rosters = await sleeperClient.getLeagueRosters(input.externalLeagueId);
      const roster = rosters.find((row) => String(row.roster_id) === input.externalRosterId);
      if (!roster) {
        throw new ApiError(
          404,
          'sleeper_roster_not_found',
          `No roster found for roster ${input.externalRosterId} in league ${input.externalLeagueId}.`,
        );
      }
      slots = mapRosterToLineupSlots(
        league.roster_positions,
        roster.starters ?? [],
        roster.players ?? [],
      );
    }

    const opponentSlots = opponentSlotsFrom(matchups, input.externalRosterId, {
      rosterPositions: league.roster_positions,
      ...(rosters ? { rosters } : {}),
    });
    return { slots, opponentSlots };
  }

  /** Static roster player IDs — no week / starter scoping (off/pre `display_phase`). */
  async fetchRosterPlayers(input: FetchRosterPlayersInput): Promise<string[]> {
    const roster = await getOwnedRoster(input.externalLeagueId, input.externalRosterId);
    return (roster.players ?? []).filter(
      (playerId) => playerId !== EMPTY_SLOT_PLAYER_ID && playerId.length > 0,
    );
  }
}

async function getOwnedRoster(externalLeagueId: string, externalRosterId: string) {
  const rosters = await sleeperClient.getLeagueRosters(externalLeagueId);
  const roster = rosters.find((r) => String(r.roster_id) === externalRosterId);
  if (!roster) {
    throw new ApiError(
      404,
      'sleeper_roster_not_found',
      `No roster found for roster ${externalRosterId} in league ${externalLeagueId}.`,
    );
  }
  return roster;
}

/** One matchups request. A 404 is an empty week, the same as the old fallback trigger. */
async function loadMatchups(externalLeagueId: string, week: number): Promise<SleeperMatchup[]> {
  try {
    const matchups = await sleeperClient.getLeagueMatchups(externalLeagueId, week);
    return Array.isArray(matchups) ? matchups : [];
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return [];
    throw error;
  }
}

/**
 * Mapped slots when a matching week matchup has a starters array; `null` when matchups
 * are unavailable, don't include this roster, or `starters` is still null (Sleeper publishes the
 * matchup before it snapshots lineups). Caller falls back to `/rosters`.
 */
function slotsFromMatchup(
  matchups: readonly SleeperMatchup[],
  externalRosterId: string,
  rosterPositions: string[],
): NormalizedLineupSlot[] | null {
  if (matchups.length === 0) return null;
  const matchup = matchups.find((row) => String(row.roster_id) === externalRosterId);
  if (!matchup || !Array.isArray(matchup.starters)) return null;
  return mapRosterToLineupSlots(rosterPositions, matchup.starters, matchup.players ?? []);
}
