/**
 * `user_lineup_cache:{user_id}:{week}` (Section 7 Redis schemas / Section 8 core types).
 * Shared between the API's lineup sync worker (writer) and the switching engine (reader, Sprint 4).
 */
export type LineupUnit = 'offense' | 'defense';

export interface UserLineupCache {
  userId: string;
  week: number;
  teamPositions: Map<string, Set<LineupUnit>>;
  playerToTeam: Map<string, string>;
  starPlayerIds: Set<string>;
  /**
   * Side of the ball for each player in `playerToTeam`. Written by `rebuildUserLineupCache`
   * (`DEF` → defense, every other roster position → offense). Absent on caches written before
   * this field: the engine then lists every player on the team, which is the previous behavior.
   */
  playerUnits?: Map<string, LineupUnit>;
}

/** JSON-serializable wire format for `UserLineupCache`, used by Redis-backed cache implementations. */
export interface SerializedUserLineupCache {
  userId: string;
  week: number;
  teamPositions: Record<string, ('offense' | 'defense')[]>;
  playerToTeam: Record<string, string>;
  starPlayerIds: string[];
  playerUnits?: Record<string, LineupUnit>;
}

export function serializeUserLineupCache(cache: UserLineupCache): SerializedUserLineupCache {
  return {
    userId: cache.userId,
    week: cache.week,
    teamPositions: Object.fromEntries(
      [...cache.teamPositions.entries()].map(([teamId, units]) => [teamId, [...units]]),
    ),
    playerToTeam: Object.fromEntries(cache.playerToTeam),
    starPlayerIds: [...cache.starPlayerIds],
    ...(cache.playerUnits ? { playerUnits: Object.fromEntries(cache.playerUnits) } : {}),
  };
}

export function deserializeUserLineupCache(serialized: SerializedUserLineupCache): UserLineupCache {
  return {
    userId: serialized.userId,
    week: serialized.week,
    teamPositions: new Map(
      Object.entries(serialized.teamPositions).map(([teamId, units]) => [teamId, new Set(units)]),
    ),
    playerToTeam: new Map(Object.entries(serialized.playerToTeam)),
    starPlayerIds: new Set(serialized.starPlayerIds),
    ...(serialized.playerUnits
      ? { playerUnits: new Map(Object.entries(serialized.playerUnits)) }
      : {}),
  };
}
