import type { GameCatalog, GameStateStore, RealtimeBus } from '@pivot/dispatcher';
import { classifyScoreboardStatus, type DiscoveryEvent, type GameDirectory } from './discovery.js';
import { publishLiveGame } from './publishLiveGame.js';

/**
 * Runs once each time this process becomes leader, before discovery starts. A run that stopped
 * mid-game leaves `games.status = in_progress` (and a live `game_state` hash) behind; nothing else
 * revisits a game once it drops off the scoreboard, so Home would keep showing it live.
 *
 * ESPN final → `game_state` final, published on the game channel, then the row set to `final`.
 * Not on the current scoreboard → logged and left alone. Still live or not started → left to
 * discovery.
 */
export async function reconcileInProgress(deps: {
  events: readonly DiscoveryEvent[];
  games: Pick<GameDirectory, 'listInProgress' | 'setStatus'>;
  gameState: GameStateStore;
  catalog: GameCatalog;
  realtime: RealtimeBus;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<{ finalized: number }> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const eventsById = new Map(deps.events.map((event) => [event.id, event]));
  const stale = await deps.games.listInProgress();
  let finalized = 0;

  for (const game of stale) {
    const label = `${game.id} (ESPN ${game.espnEventId ?? 'none'})`;
    const event = game.espnEventId === null ? undefined : eventsById.get(game.espnEventId);
    if (event === undefined) {
      log(`[runner] reconcile: ${label} is not on the current scoreboard; left in_progress`);
      continue;
    }

    const disposition = classifyScoreboardStatus(event.status?.type);
    if (disposition.kind !== 'final') {
      log(
        `[runner] reconcile: ${label} is ${disposition.kind} on the scoreboard; left to discovery`,
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
        `[runner] reconcile: finalized ${label}${existing === null ? ' (no game_state to publish)' : ''}`,
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
