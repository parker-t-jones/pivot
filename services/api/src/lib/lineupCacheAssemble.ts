import type { Position, UserLineupCache } from '@pivot/shared';

/**
 * One player the cache should remember. `leagueId` is for diffs only;
 * the assembler keeps the last row for a player, matching `remember`.
 */
export interface CachePlayerRow {
  playerId: string;
  teamId: string;
  position: string;
  star: boolean;
  leagueId: string;
}

/** The `remember` loop from `rebuildUserLineupCache`, pulled out unchanged. */
export function assembleUserLineupCache(
  userId: string,
  week: number,
  players: readonly CachePlayerRow[],
): UserLineupCache {
  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const playerUnits = new Map<string, 'offense' | 'defense'>();
  const starPlayerIds = new Set<string>();

  for (const player of players) {
    playerToTeam.set(player.playerId, player.teamId);
    const unit: 'offense' | 'defense' =
      (player.position as Position) === 'DEF' ? 'defense' : 'offense';
    playerUnits.set(player.playerId, unit);
    const categories = teamPositions.get(player.teamId) ?? new Set<'offense' | 'defense'>();
    categories.add(unit);
    teamPositions.set(player.teamId, categories);
    if (player.star) starPlayerIds.add(player.playerId);
  }

  return { userId, week, teamPositions, playerToTeam, starPlayerIds, playerUnits };
}

/**
 * Drop players whose team has no regular-season game. Empty `teamPositions`
 * sets go with them. `playerUnits` is rewritten for the players that remain.
 */
export function omitByePlayers(
  cache: UserLineupCache,
  teamsWithRegularGame: ReadonlySet<string>,
): { cache: UserLineupCache; removedPlayerIds: string[] } {
  const removedPlayerIds = [...cache.playerToTeam.keys()].filter((playerId) => {
    const teamId = cache.playerToTeam.get(playerId);
    return teamId === undefined || !teamsWithRegularGame.has(teamId);
  });
  const removed = new Set(removedPlayerIds);
  const kept: CachePlayerRow[] = [];
  for (const [playerId, teamId] of cache.playerToTeam) {
    if (removed.has(playerId)) continue;
    kept.push({
      playerId,
      teamId,
      position: cache.playerUnits?.get(playerId) === 'defense' ? 'DEF' : 'QB',
      star: cache.starPlayerIds.has(playerId),
      leagueId: '',
    });
  }
  return {
    cache: assembleUserLineupCache(cache.userId, cache.week, kept),
    removedPlayerIds,
  };
}

export interface CacheDifference {
  leagueId: string;
  playerId: string;
  field: 'player' | 'team' | 'unit' | 'star' | 'teamPositions';
}

function sameUnits(
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined,
): boolean {
  const a = left ?? new Set<string>();
  const b = right ?? new Set<string>();
  if (a.size !== b.size) return false;
  for (const unit of a) {
    if (!b.has(unit)) return false;
  }
  return true;
}

/** Order-insensitive cache diff. `leagueByPlayer` attributes a row to a league. */
export function diffLineupCaches(
  left: UserLineupCache,
  right: UserLineupCache,
  leagueByPlayer: ReadonlyMap<string, string>,
): CacheDifference[] {
  const differences: CacheDifference[] = [];
  const playerIds = new Set([...left.playerToTeam.keys(), ...right.playerToTeam.keys()]);
  for (const playerId of [...playerIds].sort()) {
    const leagueId = leagueByPlayer.get(playerId) ?? '-';
    const leftTeam = left.playerToTeam.get(playerId);
    const rightTeam = right.playerToTeam.get(playerId);
    if (leftTeam === undefined || rightTeam === undefined) {
      differences.push({ leagueId, playerId, field: 'player' });
      continue;
    }
    if (leftTeam !== rightTeam) differences.push({ leagueId, playerId, field: 'team' });
    const leftUnit = left.playerUnits?.get(playerId);
    const rightUnit = right.playerUnits?.get(playerId);
    if (leftUnit !== rightUnit) differences.push({ leagueId, playerId, field: 'unit' });
    const leftStar = left.starPlayerIds.has(playerId);
    const rightStar = right.starPlayerIds.has(playerId);
    if (leftStar !== rightStar) differences.push({ leagueId, playerId, field: 'star' });
  }

  const teams = new Set([...left.teamPositions.keys(), ...right.teamPositions.keys()]);
  for (const teamId of [...teams].sort()) {
    if (sameUnits(left.teamPositions.get(teamId), right.teamPositions.get(teamId))) continue;
    differences.push({ leagueId: '-', playerId: teamId, field: 'teamPositions' });
  }
  return differences;
}

export function formatCompareSummary(counts: {
  users: number;
  identical: number;
  different: number;
  byeExcluded: number;
}): string {
  return `[compare] users=${counts.users} identical=${counts.identical} different=${counts.different} bye_excluded=${counts.byeExcluded}`;
}

export function formatCompareDifference(userId: string, difference: CacheDifference): string {
  return `[compare] user=${userId.slice(0, 8)} league=${difference.leagueId} player=${difference.playerId} field=${difference.field}`;
}
