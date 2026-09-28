import type { GameCatalog, GameStateStore, RealtimeBus } from '@pivot/dispatcher';
import type { EspnClient, EspnScoreboardWeek } from '@pivot/ingestion';
import {
  classifyScoreboardStatus,
  type DiscoveryEvent,
  type GameDirectory,
  type StaleGame,
} from './discovery.js';
import { publishLiveGame } from './publishLiveGame.js';

type WeekEvents = ReadonlyMap<string, DiscoveryEvent>;

/** A `scheduled` row whose kickoff is further back than this is revisited on becoming leader. */
export const STALE_SCHEDULED_AFTER_MS = 5 * 60 * 60 * 1000;

/**
 * Runs once each time this process becomes leader, before discovery starts. Nothing else revisits
 * a game once it drops off the current scoreboard, so two kinds of row go stale:
 *
 * - `in_progress`: a run stopped mid-game (with a live `game_state` hash left behind), so Home
 *   would keep showing it live. Looked up on the current scoreboard, then on its own week's.
 *   Still live on the current scoreboard → left to discovery.
 * - `scheduled` with kickoff more than {@link STALE_SCHEDULED_AFTER_MS} ago: no runner was leader
 *   while it was played. Looked up on its own week's scoreboard only.
 *
 * Week scoreboards are fetched once per week per pass, shared across both kinds. ESPN final →
 * `game_state` final (if one exists), published on the game channel, then the row set to `final`.
 * ESPN doesn't have it, or it isn't final → logged and left alone.
 */
export async function reconcileStaleGames(deps: {
  scoreboard: Pick<EspnClient, 'getScoreboard'>;
  games: Pick<GameDirectory, 'listInProgress' | 'listStaleScheduled' | 'setStatus'>;
  gameState: GameStateStore;
  catalog: GameCatalog;
  realtime: RealtimeBus;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<{ finalized: number }> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const boards = new Map<string, Promise<WeekEvents>>();

  const board = (week: EspnScoreboardWeek | undefined): Promise<WeekEvents> => {
    const key = week === undefined ? 'current' : weekLabel(week);
    let cached = boards.get(key);
    if (cached === undefined) {
      cached = fetchBoard(deps.scoreboard, week, key, log);
      boards.set(key, cached);
    }
    return cached;
  };

  const finalize = async (game: StaleGame, label: string, source: string): Promise<boolean> => {
    try {
      const existing = await deps.gameState.getGameState(game.id);
      if (existing !== null) {
        await deps.gameState.setGameState(game.id, {
          ...existing,
          status: 'final',
          updatedAt: now(),
        });
        await publishLiveGame({
          gameId: game.id,
          scheduledStart: game.scheduledStart,
          gameState: deps.gameState,
          catalog: deps.catalog,
          realtime: deps.realtime,
        });
      }
      await deps.games.setStatus(game.id, 'final');
      log(
        `[runner] reconcile: finalized ${label} from the ${source} scoreboard` +
          (existing === null ? ' (no game_state to publish)' : ''),
      );
      return true;
    } catch (error) {
      log(
        `[runner] reconcile: ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };

  const inProgress = await deps.games.listInProgress();
  let finalized = 0;

  for (const game of inProgress) {
    const label = gameLabel(game);
    if (game.espnEventId === null) {
      log(`[runner] reconcile: ${label} has no ESPN id; left in_progress`);
      continue;
    }

    const found = await findEvent(game.espnEventId, game, board);
    if (found === null) {
      log(
        `[runner] reconcile: ${label} is not on the current or ${weekLabel(game)} scoreboard; left in_progress`,
      );
      continue;
    }

    const disposition = classifyScoreboardStatus(found.event.status?.type);
    if (disposition.kind !== 'final') {
      log(
        found.source === 'current'
          ? `[runner] reconcile: ${label} is ${disposition.kind} on the current scoreboard; left to discovery`
          : `[runner] reconcile: ${label} is ${disposition.kind} on the ${found.source} scoreboard; left in_progress`,
      );
      continue;
    }

    if (await finalize(game, label, found.source)) finalized += 1;
  }

  const scheduled = await deps.games.listStaleScheduled(
    new Date(now() - STALE_SCHEDULED_AFTER_MS).toISOString(),
  );

  for (const game of scheduled) {
    const label = gameLabel(game);
    if (game.espnEventId === null) {
      log(`[runner] reconcile: ${label} has no ESPN id; left scheduled`);
      continue;
    }

    const event = (await board(weekOf(game))).get(game.espnEventId);
    if (event === undefined) {
      log(
        `[runner] reconcile: ${label} is not on the ${weekLabel(game)} scoreboard; left scheduled`,
      );
      continue;
    }

    const disposition = classifyScoreboardStatus(event.status?.type);
    if (disposition.kind !== 'final') {
      log(
        `[runner] reconcile: ${label} is ${disposition.kind} on the ${weekLabel(game)} scoreboard; left scheduled`,
      );
      continue;
    }

    if (await finalize(game, label, weekLabel(game))) finalized += 1;
  }

  log(
    `[runner] reconcile in_progress=${inProgress.length} stale_scheduled=${scheduled.length} finalized=${finalized}`,
  );
  return { finalized };
}

async function findEvent(
  espnEventId: string,
  game: StaleGame,
  board: (week: EspnScoreboardWeek | undefined) => Promise<WeekEvents>,
): Promise<{ event: DiscoveryEvent; source: string } | null> {
  const current = (await board(undefined)).get(espnEventId);
  if (current !== undefined) return { event: current, source: 'current' };
  const own = (await board(weekOf(game))).get(espnEventId);
  return own === undefined ? null : { event: own, source: weekLabel(game) };
}

/** A failed fetch logs once and counts as an empty board, so its games are left alone. */
async function fetchBoard(
  scoreboard: Pick<EspnClient, 'getScoreboard'>,
  week: EspnScoreboardWeek | undefined,
  label: string,
  log: (line: string) => void,
): Promise<WeekEvents> {
  const result = await scoreboard.getScoreboard(week);
  if (!result.ok) {
    log(`[runner] reconcile: ${label} scoreboard failed: ${result.reason}`);
    return new Map();
  }
  return new Map((result.data.events ?? []).map((event) => [event.id, event]));
}

function gameLabel(game: StaleGame): string {
  return `${game.id} (ESPN ${game.espnEventId ?? 'none'})`;
}

function weekOf(game: StaleGame): EspnScoreboardWeek {
  return { seasonYear: game.seasonYear, seasonType: game.seasonType, week: game.week };
}

function weekLabel(week: EspnScoreboardWeek): string {
  return `${week.seasonYear} ${week.seasonType} week ${week.week}`;
}
