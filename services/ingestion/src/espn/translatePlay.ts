import type { PlayEvent } from '@pivot/engine';

/**
 * ESPN abbreviations and the ESPN event id become `teams.id` and `games.id`.
 * An abbreviation with no row is left unchanged. A null possession stays null.
 */
export function translatePlay(
  play: PlayEvent,
  internalGameId: string,
  abbrToUuid: Map<string, string>,
): PlayEvent {
  const home = abbrToUuid.get(play.homeTeamId) ?? play.homeTeamId;
  const away = abbrToUuid.get(play.awayTeamId) ?? play.awayTeamId;
  const possession =
    play.possessionTeamId === null
      ? null
      : (abbrToUuid.get(play.possessionTeamId) ?? play.possessionTeamId);
  return {
    ...play,
    gameId: internalGameId,
    homeTeamId: home,
    awayTeamId: away,
    possessionTeamId: possession,
  };
}
