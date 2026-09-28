import { describe, expect, it } from 'vitest';
import { lagSecondsFor, type FlagEvent, type FlagState } from '@pivot/shared';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { QueueingEventDispatcher } from './scheduleFlagEvent.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** The engine's placeholder — Section 8/onPlayEvent sets `scheduledFireAt = newState.computedAt`. */
function makeEngineEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 1_700_000_000_000, // engine placeholder == computedAt
    ...overrides,
  };
}

const CLOCK = 1_700_000_050_000;

describe('QueueingEventDispatcher (implements the engine EventDispatcher interface)', () => {
  it('does not add sunday_ticket lag to scheduledFireAt', async () => {
    expect(lagSecondsFor('sunday_ticket')).toBe(75);

    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({ queue, clock: () => CLOCK });

    await dispatcher.dispatch(makeEngineEvent());

    const due = await queue.due(CLOCK, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.scheduledFireAt).toBe(CLOCK);
    expect(due[0]?.event.scheduledFireAt).not.toBe(CLOCK + 75_000);
    expect(due[0]?.event.scheduledFireAt).not.toBe(makeEngineEvent().scheduledFireAt);
  });

  it('schedules at the clock when no broadcast source would have resolved', async () => {
    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({ queue, clock: () => CLOCK });

    await dispatcher.dispatch(makeEngineEvent());

    const due = await queue.due(CLOCK, 10);
    expect(due[0]?.event.scheduledFireAt).toBe(CLOCK);
    expect(due[0]?.event.scheduledFireAt).not.toBe(CLOCK + 60_000);
  });

  it('preserves every other field of the event unchanged', async () => {
    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({ queue, clock: () => CLOCK });

    const event = makeEngineEvent();
    await dispatcher.dispatch(event);

    const due = await queue.due(CLOCK, 10);
    expect(due[0]?.event).toEqual({ ...event, scheduledFireAt: CLOCK });
  });
});
