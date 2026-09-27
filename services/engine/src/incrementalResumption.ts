/**
 * Buffer in front of `watchForResumption` for a live play stream.
 *
 * The watcher is pure and wants the plays so far in one array. This class keeps that buffer for one
 * game and re-calls it on every arrival. It does not rescan on its own. Possession changes are
 * measured against the last play that had a known possession, and procedural plays since then are
 * prepended, so a timeout then a snap is `watchForResumption(previous, [timeout, snap])`.
 *
 * `CEILING_FALLBACK` from the pure function still requires a later play already in the array. The
 * timer here is only the silence hook.
 */

import type { PlayEvent } from './playEvent.js';
import {
  RESUMPTION_CEILING_MS,
  watchForResumption,
  type ObservedPlay,
} from './resumptionWatcher.js';

/** Why a window closed, and — for `real_action` / `ceiling` — when play is considered resumed. */
export type ResumptionResolution =
  | {
      outcome: 'REAL_ACTION';
      precedingPlay: ObservedPlay;
      triggerPlay: ObservedPlay;
      elapsedMs: number;
      /** `watcher` when the pure function returned it; `wall_clock_timer` never yields this. */
      resolvedBy: 'watcher';
    }
  | {
      outcome: 'ABORTED';
      precedingPlay: ObservedPlay;
      abortPlay: ObservedPlay;
      elapsedMs: number;
      resolvedBy: 'watcher';
    }
  | {
      outcome: 'CEILING_FALLBACK';
      precedingPlay: ObservedPlay;
      elapsedMs: number;
      /** `wall_clock_timer` is the silence timer. The pure function uses `watcher`. */
      resolvedBy: 'watcher' | 'wall_clock_timer';
    };

export interface ResumptionWindowOpened {
  precedingPlay: ObservedPlay;
  revealingPlay: ObservedPlay;
}

export interface IncrementalResumptionCallbacks {
  /** A possession change was detected and a window is now open for this game. */
  onWindowOpened?: (gameId: string, window: ResumptionWindowOpened) => void;
  /** The window closed. Fired synchronously from `observe`, or asynchronously from the ceiling timer. */
  onResolved: (gameId: string, resolution: ResumptionResolution) => void;
}

interface OpenWindow {
  precedingPlay: ObservedPlay;
  /** Plays from the possession-revealing one onward — exactly the watcher's second argument. */
  buffer: ObservedPlay[];
  ceilingTimer: NodeJS.Timeout;
}

/**
 * Tracks resumption windows for one game. One instance per game, so games do not share a buffer.
 */
export class IncrementalResumptionTracker {
  /** Most recent play with a non-null possession — the `precedingPlay` anchor for the next change. */
  private lastPossessionPlay: ObservedPlay | null = null;
  /** Procedural (null-possession) plays seen since `lastPossessionPlay`, in order. */
  private proceduralSincePossession: ObservedPlay[] = [];
  private openWindow: OpenWindow | null = null;

  constructor(
    private readonly gameId: string,
    private readonly callbacks: IncrementalResumptionCallbacks,
  ) {}

  /** True while a possession change is awaiting evidence that play resumed. */
  isWindowOpen(): boolean {
    return this.openWindow !== null;
  }

  /**
   * Feeds one play. Returns the resolution if this play closed a window, else `null`. Callers that
   * need the asynchronous ceiling path too should also handle `callbacks.onResolved`.
   */
  observe(play: PlayEvent, observedAt: number): ResumptionResolution | null {
    const observed: ObservedPlay = { play, observedAt };

    if (this.openWindow) {
      this.openWindow.buffer.push(observed);
      const resolution = this.evaluate(this.openWindow);
      if (resolution) this.closeWindow(resolution);
      this.trackPossession(observed);
      return resolution;
    }

    const previous = this.lastPossessionPlay;
    const changed =
      play.possessionTeamId !== null &&
      previous !== null &&
      previous.play.possessionTeamId !== null &&
      play.possessionTeamId !== previous.play.possessionTeamId;

    if (!changed) {
      this.trackPossession(observed);
      return null;
    }

    // Buffer starts at the first play after the possession-ending one, so a timeout in between is included.
    const buffer = [...this.proceduralSincePossession, observed];
    const revealingPlay = buffer[0];
    if (!revealingPlay) {
      this.trackPossession(observed);
      return null;
    }

    const window: OpenWindow = {
      precedingPlay: previous,
      buffer,
      ceilingTimer: this.armCeilingTimer(previous, revealingPlay),
    };
    this.openWindow = window;
    this.callbacks.onWindowOpened?.(this.gameId, { precedingPlay: previous, revealingPlay });

    const resolution = this.evaluate(window);
    if (resolution) this.closeWindow(resolution);
    this.trackPossession(observed);
    return resolution;
  }

  /** Clears the pending ceiling timer so a finished game can't keep the process alive. */
  dispose(): void {
    if (this.openWindow) {
      clearTimeout(this.openWindow.ceilingTimer);
      this.openWindow = null;
    }
  }

  /** Runs the real pure function over the current buffer and maps its result onto a resolution. */
  private evaluate(window: OpenWindow): ResumptionResolution | null {
    const result = watchForResumption(window.precedingPlay, window.buffer);

    switch (result.outcome) {
      case 'REAL_ACTION':
        return {
          outcome: 'REAL_ACTION',
          precedingPlay: window.precedingPlay,
          triggerPlay: result.triggerPlay,
          elapsedMs: result.elapsedMs,
          resolvedBy: 'watcher',
        };
      case 'ABORTED':
        return {
          outcome: 'ABORTED',
          precedingPlay: window.precedingPlay,
          abortPlay: result.abortPlay,
          elapsedMs: result.elapsedMs,
          resolvedBy: 'watcher',
        };
      case 'CEILING_FALLBACK':
        return {
          outcome: 'CEILING_FALLBACK',
          precedingPlay: window.precedingPlay,
          elapsedMs: result.elapsedMs,
          resolvedBy: 'watcher',
        };
      // `NO_MORE_PLAYS` is not terminal on a live feed: it only means the buffer is exhausted for
      // now. The window stays open for the next poll, and the ceiling timer bounds the wait.
      case 'NO_MORE_PLAYS':
        return null;
    }
  }

  /**
   * The wall-clock half of the ceiling. Anchored on `revealingPlay.observedAt` to match the pure
   * function's own `elapsedMs` reference point, so both paths report a comparable number.
   */
  private armCeilingTimer(
    precedingPlay: ObservedPlay,
    revealingPlay: ObservedPlay,
  ): NodeJS.Timeout {
    const deadline = revealingPlay.observedAt + RESUMPTION_CEILING_MS;
    const timer = setTimeout(
      () => {
        if (!this.openWindow) return;
        this.closeWindow({
          outcome: 'CEILING_FALLBACK',
          precedingPlay,
          elapsedMs: Date.now() - revealingPlay.observedAt,
          resolvedBy: 'wall_clock_timer',
        });
      },
      Math.max(0, deadline - Date.now()),
    );
    timer.unref?.();
    return timer;
  }

  private closeWindow(resolution: ResumptionResolution): void {
    if (this.openWindow) clearTimeout(this.openWindow.ceilingTimer);
    this.openWindow = null;
    this.callbacks.onResolved(this.gameId, resolution);
  }

  private trackPossession(observed: ObservedPlay): void {
    if (observed.play.possessionTeamId === null) {
      this.proceduralSincePossession.push(observed);
      return;
    }
    this.lastPossessionPlay = observed;
    this.proceduralSincePossession = [];
  }
}
