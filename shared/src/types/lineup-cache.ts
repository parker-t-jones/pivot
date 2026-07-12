/**
 * `user_lineup_cache:{user_id}:{week}` (Section 7 Redis schemas / Section 8 core types).
 * Shared between the API's lineup sync worker (writer) and the switching engine (reader, Sprint 4).
 */
export interface UserLineupCache {
  userId: string;
  week: number;
  teamPositions: Map<string, Set<'offense' | 'defense'>>;
  playerToTeam: Map<string, string>;
  starPlayerIds: Set<string>;
}

/** JSON-serializable wire format for `UserLineupCache`, used by Redis-backed cache implementations. */
export interface SerializedUserLineupCache {
  userId: string;
  week: number;
  teamPositions: Record<string, ('offense' | 'defense')[]>;
  playerToTeam: Record<string, string>;
  starPlayerIds: string[];
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
  };
}
