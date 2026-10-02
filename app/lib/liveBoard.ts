/**
 * Pure derivation for Home's live board (`state1` / `state2`, PIVOT-STAKES-PLAN.md §11.3).
 *
 * Same contract as `board.ts`: no React, no network. The screen calls it in render over data
 * `loadHome` and the WebSocket already keep in `HomeData`.
 */
import { buildBoardRows, type BoardRowData, type BoardWindowGroup, type StakeRef } from './board';
import type { LiveGame, ScheduleGame } from './schedule';

export type LiveBoardSection =
  | { kind: 'live'; rows: BoardRowData[] }
  | { kind: 'up_next'; groups: BoardWindowGroup[] }
  | { kind: 'final'; rows: BoardRowData[] };

type LivePhase = 'live' | 'up_next' | 'final';

/**
 * `final` on the week slate wins. Otherwise a game is live if the slate says so or the live list
 * has it, since a `game_state` kickoff can land before the 30s reload refreshes `weekGames`.
 */
function phaseOf(game: ScheduleGame, liveIds: ReadonlySet<string>): LivePhase {
  if (game.status === 'final') return 'final';
  if (game.status === 'in_progress' || liveIds.has(game.game_id)) return 'live';
  return 'up_next';
}

function compareGameIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Number of games in progress this week, for the `● LIVE · {n} GAMES` eyebrow. */
export function countLiveGames(weekGames: ScheduleGame[], liveGames: LiveGame[]): number {
  const liveIds = new Set(liveGames.map((game) => game.game_id));
  const ids = new Set(liveIds);
  for (const game of weekGames) {
    if (phaseOf(game, liveIds) === 'live') ids.add(game.game_id);
    else ids.delete(game.game_id);
  }
  return ids.size;
}

/**
 * The board under the live hero, in order: LIVE (games not already shown in the hero or the
 * Also Flagged tiles; stake games first, then kickoff), UP NEXT (everything not started, grouped
 * by window like the pre-game board), FINAL (most recent kickoff first). Empty sections are
 * omitted, and no game appears in more than one place.
 *
 * `heroGameIds` is every game the hero area already renders: the flagged game in `state1`, the
 * live stake game cards in `state2`.
 */
export function buildLiveBoard(input: {
  weekGames: ScheduleGame[];
  liveGames: LiveGame[];
  flaggedGameIds: readonly string[];
  heroGameIds: readonly string[];
  stakeRefs: StakeRef[];
}): LiveBoardSection[] {
  const liveIds = new Set(input.liveGames.map((game) => game.game_id));
  const shown = new Set([...input.heroGameIds, ...input.flaggedGameIds]);

  const byPhase: Record<LivePhase, ScheduleGame[]> = { live: [], up_next: [], final: [] };
  for (const game of input.weekGames) {
    byPhase[phaseOf(game, liveIds)].push(game);
  }

  const rowsFor = (games: ScheduleGame[]): BoardRowData[] =>
    buildBoardRows(games, input.stakeRefs).flatMap((group) => group.rows);

  const liveRows = rowsFor(byPhase.live)
    .filter((row) => !shown.has(row.gameId))
    .map((row) => ({ ...row, status: 'in_progress' }))
    .sort((a, b) => {
      const aStake = a.stakeCount > 0 ? 0 : 1;
      const bStake = b.stakeCount > 0 ? 0 : 1;
      if (aStake !== bStake) return aStake - bStake;
      const byKickoff = a.kickoff.getTime() - b.kickoff.getTime();
      return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
    });

  const upNextGroups = buildBoardRows(
    byPhase.up_next.filter((game) => !shown.has(game.game_id)),
    input.stakeRefs,
  );

  const finalRows = rowsFor(byPhase.final)
    .filter((row) => !shown.has(row.gameId))
    .sort((a, b) => {
      const byKickoff = b.kickoff.getTime() - a.kickoff.getTime();
      return byKickoff !== 0 ? byKickoff : compareGameIds(a.gameId, b.gameId);
    });

  const sections: LiveBoardSection[] = [];
  if (liveRows.length > 0) sections.push({ kind: 'live', rows: liveRows });
  if (upNextGroups.length > 0) sections.push({ kind: 'up_next', groups: upNextGroups });
  if (finalRows.length > 0) sections.push({ kind: 'final', rows: finalRows });
  return sections;
}
