import type { FlagEvent } from '@pivot/shared';

/**
 * Where the engine hands off emitted flag events. In Sprint 4 the only implementation captures events
 * synchronously for test assertions; Sprint 5 replaces this with the real deferred-firing dispatcher
 * (Section 8 `scheduleFlagEvent` / `flagEventDispatcher` — stream-lag queue, rate limiting, delivery),
 * which is explicitly out of scope here.
 */
export interface EventDispatcher {
  dispatch(event: FlagEvent): Promise<void>;
}

/** Records every dispatched event in order, so tests can assert on the engine's output. */
export class CapturingEventDispatcher implements EventDispatcher {
  readonly events: FlagEvent[] = [];

  async dispatch(event: FlagEvent): Promise<void> {
    this.events.push(event);
  }
}
