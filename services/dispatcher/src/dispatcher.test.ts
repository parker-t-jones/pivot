import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
import {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
} from './catalogs.js';
import type { DeliveryDeps } from './delivery.js';
import { runDispatcherTick, startDispatcherLoop, type DispatcherTickDeps } from './dispatcher.js';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { NoOpPushNotifier } from './pushNotifier.js';
import { InMemoryGameStateStore } from './providers/inMemoryGameStateStore.js';
import { InMemoryRateLimitStore } from './rateLimiter.js';
import { InMemoryRealtimeBus } from './realtimeBus.js';

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

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 1_700_000_060_000,
    ...overrides,
  };
}

const freeUser: DispatchUser = {
  id: 'u1',
  subscriptionTier: 'free',
  preferences: {
    notificationMode: 'all',
    quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
    autoSwitch: false,
  },
  expoPushToken: null, // push isn't this file's concern — see delivery.test.ts's "push" block
};

interface Harness {
  deps: DispatcherTickDeps;
  queue: InMemoryFlagEventQueue;
  gameStateStore: InMemoryGameStateStore;
  userDirectory: InMemoryUserDirectory;
  rateLimitStore: InMemoryRateLimitStore;
  realtimeBus: InMemoryRealtimeBus;
  persistence: InMemoryFlagEventPersistence;
}

function buildHarness(now: number): Harness {
  const queue = new InMemoryFlagEventQueue();
  const gameStateStore = new InMemoryGameStateStore();
  const userDirectory = new InMemoryUserDirectory();
  const rateLimitStore = new InMemoryRateLimitStore();
  const realtimeBus = new InMemoryRealtimeBus();
  const persistence = new InMemoryFlagEventPersistence();

  const delivery: DeliveryDeps = {
    gameStateStore,
    gameCatalog: new InMemoryGameCatalog(),
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog: new InMemoryBroadcastCatalog(),
    userDirectory,
    persistence,
    realtimeBus,
    rateLimitStore,
    pushNotifier: new NoOpPushNotifier(),
    clock: () => now,
  };

  const deps: DispatcherTickDeps = {
    queue,
    gameStateStore,
    userDirectory,
    rateLimitStore,
    delivery,
    clock: () => now,
  };

  return { deps, queue, gameStateStore, userDirectory, rateLimitStore, realtimeBus, persistence };
}

describe('runDispatcherTick', () => {
  it('delivers a due event that is fresh, active, and unrated, then removes it from the queue', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore, userDirectory, realtimeBus, persistence } =
      buildHarness(now);

    await gameStateStore.setUserFlagState('u1', 'g1', makeFlagState());
    await gameStateStore.markUserActive('u1', 60_000);
    userDirectory.setUser(freeUser);
    await queue.enqueue(makeEvent({ scheduledFireAt: now - 1000 }));

    const result = await runDispatcherTick(deps);

    expect(result).toEqual({
      processed: 1,
      delivered: 1,
      droppedStale: 0,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(queue.size()).toBe(0);
    expect(persistence.records).toHaveLength(1);
    expect(realtimeBus.published).toHaveLength(1);
  });

  it('ignores events not yet due', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue } = buildHarness(now);
    await queue.enqueue(makeEvent({ scheduledFireAt: now + 60_000 }));

    const result = await runDispatcherTick(deps);

    expect(result.processed).toBe(0);
    expect(queue.size()).toBe(1); // untouched, still queued for a future tick
  });

  it('drops a stale event (state changed since scheduling) without delivering', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore, userDirectory, realtimeBus } = buildHarness(now);

    // A LATER play superseded the flag state after this event was scheduled.
    await gameStateStore.setUserFlagState(
      'u1',
      'g1',
      makeFlagState({ computedAt: 1_700_000_055_000, priorityScore: 20 }),
    );
    await gameStateStore.markUserActive('u1', 60_000);
    userDirectory.setUser(freeUser);
    await queue.enqueue(makeEvent({ scheduledFireAt: now - 1000 }));

    const result = await runDispatcherTick(deps);

    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      droppedStale: 1,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(queue.size()).toBe(0);
    expect(realtimeBus.published).toHaveLength(0);
  });

  it('drops an event for a user who went inactive during the deferral window (Sprint 4 closeout #1)', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore, userDirectory, realtimeBus } = buildHarness(now);

    // State is EXACTLY fresh — nothing changed — but the user is no longer active.
    await gameStateStore.setUserFlagState('u1', 'g1', makeFlagState());
    userDirectory.setUser(freeUser);
    await queue.enqueue(makeEvent({ scheduledFireAt: now - 1000 }));
    // Deliberately not calling markUserActive.

    const result = await runDispatcherTick(deps);

    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      droppedStale: 1,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(realtimeBus.published).toHaveLength(0);
  });

  it('drops an event when the user has no directory entry', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore } = buildHarness(now);
    await gameStateStore.setUserFlagState('u1', 'g1', makeFlagState());
    await gameStateStore.markUserActive('u1', 60_000);
    await queue.enqueue(makeEvent({ scheduledFireAt: now - 1000 })); // no userDirectory.setUser call

    const result = await runDispatcherTick(deps);

    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      droppedStale: 0,
      droppedMissingUser: 1,
      droppedRateLimited: 0,
    });
  });

  it('rate-limits the 4th event for the same user within 60s', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore, userDirectory, persistence } = buildHarness(now);
    await gameStateStore.markUserActive('u1', 600_000);
    userDirectory.setUser(freeUser);

    for (let i = 0; i < 4; i += 1) {
      // `clock()` is fixed at `now` for the whole harness, so every event must already be due
      // (scheduledFireAt <= now) — using `now + i` here would push later events into the future.
      const state = makeFlagState({ computedAt: now - 1000 + i, priorityScore: 5 + i });
      await gameStateStore.setUserFlagState('u1', 'g1', state);
      await queue.enqueue(
        makeEvent({ id: `evt-${i}`, newState: state, scheduledFireAt: now - 1000 + i }),
      );
      const result = await runDispatcherTick(deps);
      if (i < 3) {
        expect(result.delivered).toBe(1);
      } else {
        expect(result.droppedRateLimited).toBe(1);
      }
    }

    expect(persistence.records).toHaveLength(3);
  });

  it('processes multiple due events across different users independently', async () => {
    const now = 1_700_000_060_000;
    const { deps, queue, gameStateStore, userDirectory, persistence } = buildHarness(now);

    for (const userId of ['u1', 'u2']) {
      await gameStateStore.setUserFlagState(userId, 'g1', makeFlagState());
      await gameStateStore.markUserActive(userId, 60_000);
      userDirectory.setUser({ ...freeUser, id: userId });
      await queue.enqueue(makeEvent({ id: `evt-${userId}`, userId, scheduledFireAt: now - 1000 }));
    }

    const result = await runDispatcherTick(deps);

    expect(result.delivered).toBe(2);
    expect(persistence.records.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });
});

describe('startDispatcherLoop', () => {
  it('polls repeatedly until the abort signal fires', async () => {
    const now = 1_700_000_060_000;
    const { deps } = buildHarness(now);
    const controller = new AbortController();
    let ticks = 0;

    await startDispatcherLoop(deps, {
      signal: controller.signal,
      pollIntervalMs: 1,
      onTick: () => {
        ticks += 1;
        if (ticks >= 3) controller.abort();
      },
    });

    expect(ticks).toBe(3);
  });
});
