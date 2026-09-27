/**
 * `EventDispatcher` that holds flag events until resumption resolves.
 *
 * On release, `scheduledFireAt` is the clock's now. A window that is still open parks the event.
 * `ABORTED` drops it. An event dispatched after the resolution on that same play fires immediately.
 */

import type { EventDispatcher, ResumptionResolution } from '@pivot/engine';
import type { FlagEvent } from '@pivot/shared';
import type { FlagEventQueue } from './queue.js';

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
  triggeringPlayId: string | null;
}

export interface ResumptionGatedDispatcherDeps {
  queue: FlagEventQueue;
  /** Called for every dispatched event once its fate is known, for the events log. */
  onGated: (record: GatedEventRecord) => void;
  clock?: () => number;
}

export class ResumptionGatedDispatcher implements EventDispatcher {
  /** gameId -> whether a possession change is currently awaiting evidence play resumed. */
  private readonly windowOpen = new Map<string, boolean>();
  /** gameId -> the resolution produced while processing the CURRENT play, if any. */
  private readonly resolutionThisPlay = new Map<string, ResumptionResolution>();
  /**
   * gameId -> a resolution that was set on the PREVIOUS play but never consumed by a `dispatch()`
   * call that play (e.g. a kickoff resolves REAL_ACTION on itself, but a kickoff never produces a
   * `flag_added` — `applyPlayToState` puts it in
   * `SPECIAL_TEAMS_PLAY_TYPES`, not `OFFENSE_PLAY_TYPES` — so the event this resolution is actually
   * FOR doesn't exist until the following offensive snap). Findings doc, Finding 2: without this,
   * `beginPlay` wiped the resolution one play before anything ever read it, so every kickoff-started
   * drive's `flag_added` went out via `fire_immediately` with `resolution: null`, silently bypassing
   * resumption-gating for the one play type (`kickoff`) most likely to actually need it.
   *
   * Deliberately bounded to exactly one extra play, not "last resolution ever": `beginPlay` demotes
   * whatever is still sitting in `resolutionThisPlay` into this slot, and the NEXT `beginPlay` call
   * (i.e. two plays after the resolution was set) drops it for good if nothing consumed it by then —
   * so a resolution can carry forward to cover the immediately-following play's event, but can't keep
   * misattributing itself to unrelated events several plays later.
   */
  private readonly carryOverResolution = new Map<string, ResumptionResolution>();
  /** gameId -> events dispatched while a window was open, awaiting its resolution. */
  private readonly parked = new Map<string, ParkedEvent[]>();

  constructor(private readonly deps: ResumptionGatedDispatcherDeps) {}

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  /**
   * Called before `onPlayEvent`, so `dispatch` can tell "a window resolved on the play
   * I am currently reacting to" from "a window resolved some plays ago". Demotes an unconsumed
   * resolution from the play that just ended into a one-play grace period (`carryOverResolution`)
   * instead of discarding it outright — see that field's comment for why.
   */
  beginPlay(gameId: string): void {
    const leftover = this.resolutionThisPlay.get(gameId);
    if (leftover) {
      this.carryOverResolution.set(gameId, leftover);
    } else {
      this.carryOverResolution.delete(gameId);
    }
    this.resolutionThisPlay.delete(gameId);
  }

  /** Called when a tracker closes a window, including from the silence timer. */
  noteResolution(gameId: string, resolution: ResumptionResolution): Promise<void> {
    this.windowOpen.set(gameId, false);
    this.resolutionThisPlay.set(gameId, resolution);
    return this.releaseParked(gameId, resolution);
  }

  /**
   * Called when a tracker opens a window. A fresh possession change starting also
   * invalidates any not-yet-consumed carry-over from a prior, now-irrelevant resolution — otherwise a
   * kickoff whose return is itself immediately fumbled (a second possession change before the first
   * one's `flag_added` ever fired) could misattribute the wrong resolution to the eventual event.
   */
  noteWindowOpened(gameId: string): void {
    this.windowOpen.set(gameId, true);
    this.carryOverResolution.delete(gameId);
  }

  async dispatch(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
    const gameId = event.gameId;

    if (this.windowOpen.get(gameId) === true) {
      const list = this.parked.get(gameId) ?? [];
      list.push({ event, parkedAt: this.now(), triggeringPlayId });
      this.parked.set(gameId, list);
      return;
    }

    const resolution =
      this.resolutionThisPlay.get(gameId) ?? this.carryOverResolution.get(gameId) ?? null;
    // Consumed at most once: the first event dispatched after a resolution lands claims it, so a
    // second, unrelated event later doesn't also inherit it.
    this.resolutionThisPlay.delete(gameId);
    this.carryOverResolution.delete(gameId);

    if (resolution?.outcome === 'ABORTED') {
      // The possession change this event describes was separated from real action by halftime or the
      // end of the game. Firing would route the user to a game that is not playing.
      this.deps.onGated({ event, decision: 'dropped_by_abort', holdMs: 0, resolution });
      return;
    }

    await this.enqueueNow(event, triggeringPlayId, 'fire_immediately', 0, resolution);
  }

  /** Flushes events parked while the window was open, once its outcome is known. */
  private async releaseParked(gameId: string, resolution: ResumptionResolution): Promise<void> {
    const list = this.parked.get(gameId);
    if (!list || list.length === 0) return;
    this.parked.delete(gameId);

    const now = this.now();
    for (const { event, parkedAt, triggeringPlayId } of list) {
      const holdMs = now - parkedAt;
      if (resolution.outcome === 'ABORTED') {
        this.deps.onGated({ event, decision: 'dropped_by_abort', holdMs, resolution });
        continue;
      }
      await this.enqueueNow(event, triggeringPlayId, 'held_pending_resumption', holdMs, resolution);
    }
  }

  /**
   * Enqueues with `scheduledFireAt` = now, so the real 500ms `runDispatcherTick` picks it up on its
   * next pass. "Now" is correct rather than lazy: resumption has already been evidenced by this
   * point, which is the whole premise — there is no further delay left to model.
   */
  private async enqueueNow(
    event: FlagEvent,
    triggeringPlayId: string | null,
    decision: GateDecision,
    holdMs: number,
    resolution: ResumptionResolution | null,
  ): Promise<void> {
    await this.deps.queue.enqueue({ ...event, scheduledFireAt: this.now() }, triggeringPlayId);
    this.deps.onGated({ event, decision, holdMs, resolution });
  }
}
