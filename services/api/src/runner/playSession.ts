import {
  IncrementalResumptionTracker,
  classifyPlayType,
  onPlayEvent,
  type OnPlayEventDeps,
  type PlayEvent,
} from '@pivot/engine';
import type { ResumptionCeiling, ResumptionGatedDispatcher } from '@pivot/dispatcher';
import { observeResolution } from './observeResolution.js';

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PlaySessionDeps {
  gameId: string;
  gate: ResumptionGatedDispatcher;
  ceiling: ResumptionCeiling;
  onPlay: OnPlayEventDeps;
  clock?: () => number;
  log?: (line: string) => void;
}

/**
 * The per-game wiring the runner uses for every live play. Opens and closes the possession
 * window on the gate, holds mid-drive events until the next real play, and flushes the play.
 */
export function createPlaySession(deps: PlaySessionDeps): {
  tracker: IncrementalResumptionTracker;
  handlePlay(play: PlayEvent): Promise<void>;
  dispose(): void;
} {
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? console.error;
  const tracker = new IncrementalResumptionTracker(deps.gameId, {
    onWindowOpened: (gameId, window) => {
      deps.gate.noteWindowOpened(gameId);
      void deps.ceiling.onWindowOpened(gameId, window).catch((error: unknown) => {
        log(`[runner] ceiling open failed ${gameId}: ${failureReason(error)}`);
      });
    },
    onResolved: (gameId, resolution) => {
      void deps.ceiling.onResolved(gameId).catch((error: unknown) => {
        log(`[runner] ceiling clear failed ${gameId}: ${failureReason(error)}`);
      });
      observeResolution(gameId, deps.gate.noteResolution(gameId, resolution), log);
    },
  });

  return {
    tracker,
    async handlePlay(play: PlayEvent): Promise<void> {
      deps.gate.beginPlay(play.gameId);
      if (classifyPlayType(play.playType) === 'REAL_ACTION') {
        await deps.gate.releaseMidDrive(play.gameId);
      }
      tracker.observe(play, clock());
      await onPlayEvent(deps.onPlay, play);
      await deps.gate.endPlay(play.gameId);
      // The play that ends the game has no following snap. Release anything still parked so the
      // final flag (usually a clear) is published instead of waiting out the silence ceiling.
      const settled = await deps.onPlay.gameState.getGameState(play.gameId);
      if (settled?.status === 'final') {
        await deps.gate.releaseMidDrive(play.gameId);
      }
    },
    dispose(): void {
      tracker.dispose();
    },
  };
}
