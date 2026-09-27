import { defaultClock, type Clock, type EventDispatcher } from '@pivot/engine';
import type { FlagEvent } from '@pivot/shared';
import type { FlagEventQueue } from './queue.js';

export interface ScheduleFlagEventDeps {
  queue: FlagEventQueue;
  clock?: Clock;
}

/**
 * PLAN.md Section 8 "Deferred event scheduling" (`scheduleFlagEvent`), wired in as the engine's
 * `EventDispatcher` (Sprint 4's frozen interface — `services/engine/src/eventDispatcher.ts`). This is
 * how Sprint 5 replaces `CapturingEventDispatcher` without touching a single engine file: `onPlayEvent`
 * already calls `deps.dispatcher.dispatch(event)`, so swapping the injected dispatcher instance is the
 * entire integration point.
 *
 * Per Sprint 4 closeout item #3, this OVERWRITES `event.scheduledFireAt` — the engine's placeholder
 * value (`newState.computedAt`) is discarded, never read. Fire time is the clock's now.
 * `lagSecondsFor` is a ranking tiebreak, not a delay added here.
 */
export class QueueingEventDispatcher implements EventDispatcher {
  constructor(private readonly deps: ScheduleFlagEventDeps) {}

  async dispatch(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
    const clock = this.deps.clock ?? defaultClock;
    const scheduled: FlagEvent = { ...event, scheduledFireAt: clock() };
    await this.deps.queue.enqueue(scheduled, triggeringPlayId);
  }
}
