import {
  buildGameSummary,
  realtimeGameChannel,
  type GameCatalog,
  type GameStateStore,
  type RealtimeBus,
} from '@pivot/dispatcher';
import { buildEnvelope } from '../websocket/messages.js';

/**
 * After an applied play, publish the live-list object for this game.
 * `in_progress` matches `GET /games/live`. `final` is the same object with that status, so Home
 * can drop the game without waiting for the 30s reconcile. Any other status is not published.
 */
export async function publishLiveGame(deps: {
  gameId: string;
  scheduledStart: string;
  gameState: GameStateStore;
  catalog: GameCatalog;
  realtime: RealtimeBus;
  now?: number;
}): Promise<void> {
  const state = await deps.gameState.getGameState(deps.gameId);
  if (!state || (state.status !== 'in_progress' && state.status !== 'final')) return;
  const summary = buildGameSummary(state, await deps.catalog.getGameSummary(deps.gameId));
  await deps.realtime.publish(
    realtimeGameChannel(deps.gameId),
    buildEnvelope(
      'game_state',
      {
        game_id: deps.gameId,
        status: state.status,
        scheduled_start: deps.scheduledStart,
        ...summary,
      },
      deps.now,
    ),
  );
}
