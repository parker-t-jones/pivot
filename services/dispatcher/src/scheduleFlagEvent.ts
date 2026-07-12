import { defaultClock, type Clock, type EventDispatcher } from '@fantasy-focus/engine';
import type { FlagEvent } from '@fantasy-focus/shared';
import {
  lagSecondsFor,
  resolveLikelyBroadcastSource,
  type BroadcastCatalog,
} from './broadcastLag.js';
import type { FlagEventQueue } from './queue.js';

export interface ScheduleFlagEventDeps {
  queue: FlagEventQueue;
  broadcastCatalog: BroadcastCatalog;
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
 * value (`newState.computedAt`) is discarded, never read. The dispatcher is the sole owner of real
 * fire-time scheduling.
 */
export class QueueingEventDispatcher implements EventDispatcher {
  constructor(private readonly deps: ScheduleFlagEventDeps) {}

  async dispatch(event: FlagEvent): Promise<void> {
    const clock = this.deps.clock ?? defaultClock;
    const broadcastSource = await resolveLikelyBroadcastSource(
      event.gameId,
      event.userId,
      this.deps.broadcastCatalog,
    );
    const lagSec = lagSecondsFor(broadcastSource);

    const scheduled: FlagEvent = { ...event, scheduledFireAt: clock() + lagSec * 1000 };
    await this.deps.queue.enqueue(scheduled);
  }
}
