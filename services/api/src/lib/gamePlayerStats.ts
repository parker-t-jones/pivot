import type { GamePlayerStats } from '@pivot/shared';

/**
 * `game_player_stats:{gameId}`: the latest parsed ESPN summary for a live game, written by the
 * runner on every poll and read by `GET /picks` for in-app progress (the same live, unheld path
 * `GET /games/live` uses for scores). Never pushed.
 */
export const GAME_PLAYER_STATS_TTL_SEC = 12 * 60 * 60;

export function gamePlayerStatsKey(gameId: string): string {
  return `game_player_stats:${gameId}`;
}

export interface GamePlayerStatsWriter {
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface GamePlayerStatsReader {
  get(key: string): Promise<string | null>;
}

export async function writeGamePlayerStats(
  redis: GamePlayerStatsWriter,
  stats: GamePlayerStats,
): Promise<void> {
  await redis.set(
    gamePlayerStatsKey(stats.gameId),
    JSON.stringify(stats),
    GAME_PLAYER_STATS_TTL_SEC,
  );
}

function isStats(value: unknown, gameId: string): value is GamePlayerStats {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GamePlayerStats>;
  return (
    candidate.gameId === gameId &&
    typeof candidate.players === 'object' &&
    candidate.players !== null &&
    Array.isArray(candidate.scoringPlays) &&
    Array.isArray(candidate.linescores?.home) &&
    Array.isArray(candidate.linescores?.away)
  );
}

/** Null when missing or unreadable: callers show "no stats yet", never invented zeros. */
export async function readGamePlayerStats(
  redis: GamePlayerStatsReader,
  gameId: string,
): Promise<GamePlayerStats | null> {
  const raw = await redis.get(gamePlayerStatsKey(gameId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStats(parsed, gameId) ? parsed : null;
  } catch {
    return null;
  }
}

/** ESPN abbreviations on a parsed summary become `teams.id`, as `translatePlay` does for plays. */
export function translateStatsTeams(
  stats: GamePlayerStats,
  abbrToUuid: ReadonlyMap<string, string>,
): GamePlayerStats {
  const team = (id: string): string => abbrToUuid.get(id) ?? id;
  return {
    ...stats,
    players: Object.fromEntries(
      Object.entries(stats.players).map(([id, line]) => [
        id,
        { ...line, teamId: team(line.teamId) },
      ]),
    ),
    scoringPlays: stats.scoringPlays.map((play) => ({ ...play, teamId: team(play.teamId) })),
  };
}
