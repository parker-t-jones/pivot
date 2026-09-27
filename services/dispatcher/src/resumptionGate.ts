/**
 * `EventDispatcher` that holds flag events until resumption resolves.
 *
 * On release, `scheduledFireAt` is the clock's now. A window that is still open parks the event.
 * `ABORTED` drops it. An event dispatched after the resolution on that same play fires immediately.
 */

import type { EventDispatcher, ResumptionResolution } from '@pivot/engine';
import type { FlagEvent } from '@pivot/shared';
import { collapseByUser, isPushEligibleEvent } from './collapseFlagEvents.js';
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

interface WindowCandidate {
  event: FlagEvent;
  triggeringPlayId: string | null;
  decision: 'fire_immediately' | 'held_pending_resumption';
  holdMs: number;
  resolution: ResumptionResolution;
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
  /** gameId -> beginPlay has run and endPlay has not. */
  private readonly playInProgress = new Set<string>();
  /** gameId -> this play already dropped an event for an ABORTED window. */
  private readonly droppedAbort = new Set<string>();
  /**
   * gameId -> events in the reveal window that is resolving on the current play. Flushed by
   * `endPlay`, after `onPlayEvent` has dispatched everything that play will emit.
   */
  private readonly resolving = new Map<string, WindowCandidate[]>();

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
    this.playInProgress.add(gameId);
  }

  /** Collapses this play's reveal window and enqueues one event per user. */
  async endPlay(gameId: string): Promise<void> {
    this.playInProgress.delete(gameId);
    const items = this.resolving.get(gameId) ?? [];
    this.resolving.delete(gameId);
    const playDispatched = items.some((item) => item.decision === 'fire_immediately');
    const droppedAbort = this.droppedAbort.has(gameId);
    this.droppedAbort.delete(gameId);
    await this.enqueueCollapsed(items);
    if (playDispatched || droppedAbort) {
      this.resolutionThisPlay.delete(gameId);
      this.carryOverResolution.delete(gameId);
    }
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

    const thisPlayResolution = this.resolutionThisPlay.get(gameId) ?? null;
    if (this.playInProgress.has(gameId) && thisPlayResolution?.outcome === 'ABORTED') {
      this.droppedAbort.add(gameId);
      this.deps.onGated({
        event,
        decision: 'dropped_by_abort',
        holdMs: 0,
        resolution: thisPlayResolution,
      });
      return;
    }
    if (
      this.playInProgress.has(gameId) &&
      thisPlayResolution &&
      thisPlayResolution.outcome !== 'ABORTED'
    ) {
      const list = this.resolving.get(gameId) ?? [];
      list.push({
        event,
        triggeringPlayId,
        decision: 'fire_immediately',
        holdMs: 0,
        resolution: thisPlayResolution,
      });
      this.resolving.set(gameId, list);
      return;
    }

    const resolution = thisPlayResolution ?? this.carryOverResolution.get(gameId) ?? null;
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
    if (resolution.outcome === 'ABORTED') {
      for (const { event, parkedAt } of list) {
        this.deps.onGated({
          event,
          decision: 'dropped_by_abort',
          holdMs: now - parkedAt,
          resolution,
        });
      }
      return;
    }

    const held: WindowCandidate[] = list.map(({ event, parkedAt, triggeringPlayId }) => ({
      event,
      triggeringPlayId,
      decision: 'held_pending_resumption',
      holdMs: now - parkedAt,
      resolution,
    }));
    if (this.playInProgress.has(gameId)) {
      const batch = this.resolving.get(gameId) ?? [];
      batch.push(...held);
      this.resolving.set(gameId, batch);
      return;
    }
    await this.enqueueCollapsed(held);
  }

  private async enqueueCollapsed(items: readonly WindowCandidate[]): Promise<void> {
    const bypass: WindowCandidate[] = [];
    const eligible: WindowCandidate[] = [];
    for (const item of items) {
      if (isPushEligibleEvent(item.event.type)) eligible.push(item);
      else bypass.push(item);
    }
    for (const item of bypass) {
      await this.enqueueNow(
        item.event,
        item.triggeringPlayId,
        item.decision,
        item.holdMs,
        item.resolution,
      );
    }
    const winners = collapseByUser(eligible);
    const winnerByUser = new Map(winners.map((winner) => [winner.event.userId, winner]));
    for (const item of eligible) {
      const winner = winnerByUser.get(item.event.userId);
      if (!winner || winner === item) continue;
      console.log(
        `[gate] collapsed ${item.event.type} ${item.event.gameId} for ${item.event.userId} into ${winner.event.type}`,
      );
    }
    for (const winner of winners) {
      await this.enqueueNow(
        winner.event,
        winner.triggeringPlayId,
        winner.decision,
        winner.holdMs,
        winner.resolution,
      );
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
