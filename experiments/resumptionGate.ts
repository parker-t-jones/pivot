/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * The `EventDispatcher` the engine hands flag events to during the live test, gating them on
 * resumption detection instead of on a fixed delay.
 *
 * This deliberately replaces `QueueingEventDispatcher` rather than wrapping it. That class sets
 * `scheduledFireAt = now + lagSecondsFor(source) * 1000` — the fixed per-platform padding. Today's
 * test is about using the resumption watcher's detected trigger time as the scheduling input instead,
 * which is precisely the substitution PLAN.md Section 8's "Open items" names as unbuilt. Everything
 * downstream of the queue is untouched: `runDispatcherTick` -> `isStillRelevant` -> `deliverFlagEvent`
 * all run exactly as they do in the integration test.
 *
 * WHAT THIS IS EXPECTED TO SHOW. Normalized `PlayEvent`s carry `possessionTeamId: null` on every
 * procedural play, and every play type that classifies `SKIP_AND_WAIT` is in that null set. So the
 * play that reveals a new possession is always itself `REAL_ACTION`, which means an opening window
 * resolves on the very same play that opened it — either `REAL_ACTION` (fire now) or, if halftime
 * intervened, `ABORTED` (drop). The predicted consequence is that `holdMs` is ~0 for every event and
 * the ceiling timer never fires.
 *
 * That prediction is the thing under test, so the hold and ceiling paths are implemented properly
 * rather than asserted away: if ESPN produces a sequence that does hold, the logs will say so with a
 * real number attached. Measuring it is the point; assuming it would defeat the exercise.
 */

import type { FlagEventQueue } from '@pivot/dispatcher';
import type { FlagEvent } from '@pivot/shared';
import type { ResumptionResolution } from './incrementalResumption.js';

/** What the gate decided to do with an event at dispatch time. */
export type GateDecision = 'fire_immediately' | 'held_pending_resumption' | 'dropped_by_abort';

export interface GatedEventRecord {
  event: FlagEvent;
  decision: GateDecision;
  /** Wall-clock ms the event spent parked before being enqueued. `0` for an immediate fire. */
  holdMs: number;
  /** The resumption resolution that released or dropped it, when one applied. */
  resolution: ResumptionResolution | null;
}

interface ParkedEvent {
  event: FlagEvent;
  parkedAt: number;
}

export interface ResumptionGatedDispatcherDeps {
  queue: FlagEventQueue;
  /** Called for every dispatched event once its fate is known, for the events log. */
  onGated: (record: GatedEventRecord) => void;
  clock?: () => number;
}

export class ResumptionGatedDispatcher {
  /** gameId -> whether a possession change is currently awaiting evidence play resumed. */
  private readonly windowOpen = new Map<string, boolean>();
  /** gameId -> the resolution produced while processing the CURRENT play, if any. */
  private readonly resolutionThisPlay = new Map<string, ResumptionResolution>();
  /** gameId -> events dispatched while a window was open, awaiting its resolution. */
  private readonly parked = new Map<string, ParkedEvent[]>();

  constructor(private readonly deps: ResumptionGatedDispatcherDeps) {}

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  /**
   * Called by the harness before `onPlayEvent`, so `dispatch` can tell "a window resolved on the play
   * I am currently reacting to" from "a window resolved some plays ago".
   */
  beginPlay(gameId: string): void {
    this.resolutionThisPlay.delete(gameId);
  }

  /** Called by the harness when a tracker closes a window — including from the ceiling timer. */
  noteResolution(gameId: string, resolution: ResumptionResolution): void {
    this.windowOpen.set(gameId, false);
    this.resolutionThisPlay.set(gameId, resolution);
    void this.releaseParked(gameId, resolution);
  }

  /** Called by the harness when a tracker opens a window. */
  noteWindowOpened(gameId: string): void {
    this.windowOpen.set(gameId, true);
  }

  async dispatch(event: FlagEvent): Promise<void> {
    const gameId = event.gameId;

    if (this.windowOpen.get(gameId) === true) {
      const list = this.parked.get(gameId) ?? [];
      list.push({ event, parkedAt: this.now() });
      this.parked.set(gameId, list);
      return;
    }

    const resolution = this.resolutionThisPlay.get(gameId) ?? null;

    if (resolution?.outcome === 'ABORTED') {
      // The possession change this event describes was separated from real action by halftime or the
      // end of the game. Firing would route the user to a game that is not playing.
      this.deps.onGated({ event, decision: 'dropped_by_abort', holdMs: 0, resolution });
      return;
    }

    await this.enqueueNow(event, 'fire_immediately', 0, resolution);
  }

  /** Flushes events parked while the window was open, once its outcome is known. */
  private async releaseParked(gameId: string, resolution: ResumptionResolution): Promise<void> {
    const list = this.parked.get(gameId);
    if (!list || list.length === 0) return;
    this.parked.delete(gameId);

    const now = this.now();
    for (const { event, parkedAt } of list) {
      const holdMs = now - parkedAt;
      if (resolution.outcome === 'ABORTED') {
        this.deps.onGated({ event, decision: 'dropped_by_abort', holdMs, resolution });
        continue;
      }
      await this.enqueueNow(event, 'held_pending_resumption', holdMs, resolution);
    }
  }

  /**
   * Enqueues with `scheduledFireAt` = now, so the real 500ms `runDispatcherTick` picks it up on its
   * next pass. "Now" is correct rather than lazy: resumption has already been evidenced by this
   * point, which is the whole premise — there is no further delay left to model.
   */
  private async enqueueNow(
    event: FlagEvent,
    decision: GateDecision,
    holdMs: number,
    resolution: ResumptionResolution | null,
  ): Promise<void> {
    await this.deps.queue.enqueue({ ...event, scheduledFireAt: this.now() });
    this.deps.onGated({ event, decision, holdMs, resolution });
  }
}
