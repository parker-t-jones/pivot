import {
  IncrementalResumptionTracker,
  classifyPlayType,
  onPlayEvent,
  possessionChangeAtPlayEnd,
  type OnPlayEventDeps,
  type PlayEvent,
} from '@pivot/engine';
import type { ResumptionCeiling, ResumptionGatedDispatcher } from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';
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
  /** Runs after `onPlayEvent` and before this play's reveal window collapses. */
  runBetPass?: (play: PlayEvent, gameState: GameState) => Promise<void>;
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
  /** The last play that handed the ball over early, until the next play that names a team. */
  let pendingNudge: { playId: string; to: string } | null = null;

  /**
   * Issue #7: an early possession change can be wrong (a muff ESPN later revises). No correction
   * push is sent: the next play's flags supersede it. This only logs the case.
   */
  function noteOverturn(play: PlayEvent): void {
    if (pendingNudge === null || play.possessionTeamId === null) return;
    const nudge = pendingNudge;
    pendingNudge = null;
    if (play.playType === 'kickoff' || play.possessionTeamId === nudge.to) return;
    log(
      `[runner] possession nudge overturned game=${play.gameId} nudge_play=${nudge.playId} play=${play.playId} nudged=${nudge.to} actual=${play.possessionTeamId}`,
    );
  }
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
      deps.gate.beginPlay(play.gameId, play.playType);
      if (classifyPlayType(play.playType) === 'REAL_ACTION') {
        await deps.gate.releaseMidDrive(play.gameId);
      }
      tracker.observe(play, clock());
      noteOverturn(play);
      const before = await deps.onPlay.gameState.getGameState(play.gameId);
      const nudgedTo = possessionChangeAtPlayEnd(before, play);
      if (nudgedTo !== null) {
        pendingNudge = { playId: play.playId, to: nudgedTo };
      }
      await onPlayEvent(deps.onPlay, play);
      const gameState = await deps.onPlay.gameState.getGameState(play.gameId);
      if (deps.runBetPass && gameState) await deps.runBetPass(play, gameState);
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
