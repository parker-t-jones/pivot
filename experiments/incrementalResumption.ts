/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Feeds `@pivot/engine`'s `watchForResumption` from a live, incrementally-arriving play stream.
 *
 * The promoted watcher is a pure function over a COMPLETE play array: `watchForResumption(preceding,
 * playsFromPossessionChange)`. That shape came from the backtest, which replayed an already-captured
 * log all at once. A live feed hands us one play at a time, so something has to bridge the two.
 *
 * The bridge deliberately does NOT reimplement the algorithm as a state machine. It keeps a per-game
 * buffer and RE-CALLS the pure function on the grown buffer each time a play arrives. Because the
 * function rescans from the start and is side-effect free, re-calling it on a growing array returns
 * the same answer the backtest would have given for that prefix, and flips to `REAL_ACTION` on
 * exactly the play where the trigger lands. The cost is O(n^2) over a handful of plays per window,
 * which is irrelevant here and buys the thing that matters on a test day: the code under test is the
 * validated function, byte for byte, not a paraphrase of it.
 *
 * Two behaviors worth knowing about, both discovered while wiring this up:
 *
 * 1. WINDOW ANCHORING. `PlayEvent.possessionTeamId` is `null` on every procedural play (see
 *    `mapEspnPlay`'s `NO_POSSESSION_PLAY_TYPES`), so a naive "possession differs from the previous
 *    play" test would fire on every timeout. Possession changes are therefore detected against the
 *    last play that had a KNOWN possession, and the buffer handed to the watcher includes the
 *    procedural plays observed in between. That reproduces the reference cases exactly — the
 *    TD -> timeout -> kickoff case becomes `watchForResumption(td, [timeout, kickoff])`, which is
 *    verbatim what `resumptionWatcher.test.ts` asserts.
 *
 * 2. THE CEILING CANNOT FIRE ON SILENCE. `RESUMPTION_CEILING_MS` is only evaluated inside the pure
 *    function's loop over arriving plays. In the backtest a next play always existed, so the ceiling
 *    was reachable. Live, a long stoppage means NO plays arrive at all — the exact condition the
 *    ceiling exists to catch is the one that starves it. A wall-clock timer covers that here, and
 *    resolutions record which mechanism won (`resolvedBy`) so the logs can distinguish them.
 */

import {
  RESUMPTION_CEILING_MS,
  watchForResumption,
  type ObservedPlay,
  type PlayEvent,
} from '@pivot/engine';

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
      /** `wall_clock_timer` is the harness-only path described in the file header. */
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
 * Tracks resumption windows for ONE game. The harness owns one of these per game so nothing is
 * shared across the slate — the multi-game footgun this whole test exists to look for.
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

    // Buffer starts at the first play after the possession-ending one, so intervening procedural
    // plays are included — see WINDOW ANCHORING in the file header.
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
  private armCeilingTimer(precedingPlay: ObservedPlay, revealingPlay: ObservedPlay): NodeJS.Timeout {
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
