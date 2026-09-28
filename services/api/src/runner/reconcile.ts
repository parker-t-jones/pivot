import type { GameCatalog, GameStateStore, RealtimeBus } from '@pivot/dispatcher';
import type { EspnClient, EspnScoreboardWeek } from '@pivot/ingestion';
import {
  classifyScoreboardStatus,
  type DiscoveryEvent,
  type GameDirectory,
  type InProgressGame,
} from './discovery.js';
import { publishLiveGame } from './publishLiveGame.js';

type WeekEvents = ReadonlyMap<string, DiscoveryEvent>;

/**
 * Runs once each time this process becomes leader, before discovery starts. A run that stopped
 * mid-game leaves `games.status = in_progress` (and a live `game_state` hash) behind; nothing else
 * revisits a game once it drops off the scoreboard, so Home would keep showing it live.
 *
 * Each game is looked up on the current scoreboard, then on its own season/week scoreboard (one
 * fetch per week per pass). ESPN final → `game_state` final, published on the game channel, then
 * the row set to `final`. Still live on the current scoreboard → left to discovery. ESPN doesn't
 * have it, or it isn't final → logged and left alone.
 */
export async function reconcileInProgress(deps: {
  scoreboard: Pick<EspnClient, 'getScoreboard'>;
  games: Pick<GameDirectory, 'listInProgress' | 'setStatus'>;
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

  const stale = await deps.games.listInProgress();
  let finalized = 0;

  for (const game of stale) {
    const label = `${game.id} (ESPN ${game.espnEventId ?? 'none'})`;
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
      finalized += 1;
      log(
        `[runner] reconcile: finalized ${label} from the ${found.source} scoreboard` +
          (existing === null ? ' (no game_state to publish)' : ''),
      );
    } catch (error) {
      log(
        `[runner] reconcile: ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  log(`[runner] reconcile in_progress=${stale.length} finalized=${finalized}`);
  return { finalized };
}

async function findEvent(
  espnEventId: string,
  game: InProgressGame,
  board: (week: EspnScoreboardWeek | undefined) => Promise<WeekEvents>,
): Promise<{ event: DiscoveryEvent; source: string } | null> {
  const current = (await board(undefined)).get(espnEventId);
  if (current !== undefined) return { event: current, source: 'current' };
  const own = (
    await board({ seasonYear: game.seasonYear, seasonType: game.seasonType, week: game.week })
  ).get(espnEventId);
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

function weekLabel(week: EspnScoreboardWeek): string {
  return `${week.seasonYear} ${week.seasonType} week ${week.week}`;
}
