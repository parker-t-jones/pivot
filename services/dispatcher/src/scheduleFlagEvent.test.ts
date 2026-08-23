import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
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

describe('QueueingEventDispatcher (implements the engine EventDispatcher interface)', () => {
  it('overwrites the engine placeholder scheduledFireAt with clock() + resolved lag', async () => {
    const catalog = new InMemoryBroadcastCatalog();
    catalog.setGameBroadcasts('g1', [
      { service: 'fox', deepLinkUrl: 'https://fox.example', requiresSubscription: false },
    ]);
    catalog.setUserSubscribedServices('u1', ['fox']);

    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({
      queue,
      broadcastCatalog: catalog,
      clock: () => 1_700_000_050_000,
    });

    await dispatcher.dispatch(makeEngineEvent());

    const due = await queue.due(1_700_000_050_000 + 8_000, 10);
    expect(due).toHaveLength(1);
    // fox lag = 8s -> 1_700_000_050_000 + 8000, NOT the engine's placeholder (1_700_000_000_000).
    expect(due[0]?.event.scheduledFireAt).toBe(1_700_000_058_000);
    expect(due[0]?.event.scheduledFireAt).not.toBe(makeEngineEvent().scheduledFireAt);
  });

  it('falls back to the 60s default lag when no broadcast source resolves', async () => {
    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({
      queue,
      broadcastCatalog: new InMemoryBroadcastCatalog(), // no data seeded -> no match
      clock: () => 1_700_000_050_000,
    });

    await dispatcher.dispatch(makeEngineEvent());

    const due = await queue.due(1_700_000_050_000 + 60_000, 10);
    expect(due[0]?.event.scheduledFireAt).toBe(1_700_000_110_000);
  });

  it('preserves every other field of the event unchanged', async () => {
    const queue = new InMemoryFlagEventQueue();
    const dispatcher = new QueueingEventDispatcher({
      queue,
      broadcastCatalog: new InMemoryBroadcastCatalog(),
      clock: () => 1_700_000_050_000,
    });

    const event = makeEngineEvent();
    await dispatcher.dispatch(event);

    const due = await queue.due(1_700_000_050_000 + 60_000, 10);
    expect(due[0]?.event).toEqual({ ...event, scheduledFireAt: 1_700_000_110_000 });
  });
});
