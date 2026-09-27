import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IncrementalResumptionTracker,
  RESUMPTION_CEILING_MS,
  type PlayEvent,
  type ResumptionWindowOpened,
} from '@pivot/engine';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import {
  InMemoryResumptionOpenStore,
  ResumptionCeiling,
  resumptionOpenKey,
} from './resumptionCeiling.js';
import { ResumptionGatedDispatcher } from './resumptionGate.js';

const T0 = 1_700_000_000_000;

function play(overrides: Partial<PlayEvent>): PlayEvent {
  return {
    playId: 'p',
    gameId: 'g1',
    week: 1,
    homeTeamId: 'DET',
    awayTeamId: 'IND',
    possessionTeamId: 'IND',
    playType: 'punt',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 600,
    yardsToOpponentEndzone: 50,
    down: null,
    distance: null,
    isFinalPlay: false,
    ...overrides,
  };
}

function flagEvent(): FlagEvent {
  const state: FlagState = {
    gameId: 'g1',
    flagged: true,
    priorityScore: 1,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: T0,
  };
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: state,
    scheduledFireAt: 0,
  };
}

function wire(): {
  tracker: IncrementalResumptionTracker;
  ceiling: ResumptionCeiling;
  queue: InMemoryFlagEventQueue;
  gate: ResumptionGatedDispatcher;
  store: InMemoryResumptionOpenStore;
  flush: () => Promise<void>;
} {
  const store = new InMemoryResumptionOpenStore();
  const queue = new InMemoryFlagEventQueue();
  const gate = new ResumptionGatedDispatcher({
    queue,
    onGated: () => undefined,
    clock: () => Date.now(),
  });
  const pending: Promise<void>[] = [];
  let ceiling!: ResumptionCeiling;
  const tracker = new IncrementalResumptionTracker('g1', {
    onWindowOpened: (gameId, window: ResumptionWindowOpened) => {
      pending.push(ceiling.onWindowOpened(gameId, window));
      gate.noteWindowOpened(gameId);
    },
    onResolved: (gameId, resolution) => {
      pending.push(ceiling.onResolved(gameId));
      pending.push(gate.noteResolution(gameId, resolution));
    },
  });
  ceiling = new ResumptionCeiling({
    store,
    clock: () => Date.now(),
    onFire: () => tracker.applyWallClockCeiling(Date.now()),
  });
  return {
    tracker,
    ceiling,
    queue,
    gate,
    store,
    flush: async () => {
      const batch = pending.splice(0, pending.length);
      await Promise.all(batch);
    },
  };
}

describe('ResumptionCeiling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues once at now after 4 minutes with no later play', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { tracker, queue, gate, store, flush } = wire();

    tracker.observe(play({ playId: 'punt', possessionTeamId: 'IND' }), T0);
    tracker.observe(play({ playId: 'timeout', playType: 'timeout', possessionTeamId: 'DET' }), T0);
    await flush();
    await gate.dispatch(flagEvent());

    const stored = await store.read(resumptionOpenKey('g1'));
    expect(stored).toEqual({ openedAt: T0, revealingPlayId: 'timeout' });
    expect(queue.size()).toBe(0);

    await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS - 1);
    await flush();
    expect(queue.size()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(queue.size()).toBe(1);
    const due = await queue.due(Date.now(), 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.scheduledFireAt).toBe(T0 + RESUMPTION_CEILING_MS);
    expect(await store.read(resumptionOpenKey('g1'))).toBeNull();
    tracker.dispose();
  });

  it('clears the timer when a play resolves the window first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const { tracker, queue, gate, store, flush } = wire();

    tracker.observe(play({ playId: 'punt', possessionTeamId: 'IND' }), T0);
    tracker.observe(play({ playId: 'timeout', playType: 'timeout', possessionTeamId: 'DET' }), T0);
    await flush();
    await gate.dispatch(flagEvent());

    tracker.observe(play({ playId: 'snap', playType: 'run', possessionTeamId: 'DET' }), T0 + 1_000);
    await flush();
    expect(queue.size()).toBe(1);
    expect(await store.read(resumptionOpenKey('g1'))).toBeNull();

    await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS);
    await flush();
    expect(queue.size()).toBe(1);
    tracker.dispose();
  });

  it('rearms the remainder and fires immediately when the deadline has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const store = new InMemoryResumptionOpenStore();
    const fired: string[] = [];
    const ceiling = new ResumptionCeiling({
      store,
      clock: () => Date.now(),
      onFire: (gameId) => fired.push(gameId),
    });

    await store.put(resumptionOpenKey('g1'), { openedAt: T0 - 60_000, revealingPlayId: 'timeout' });
    await ceiling.rearm('g1');
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS - 60_000);
    expect(fired).toEqual(['g1']);
    expect(await store.read(resumptionOpenKey('g1'))).toBeNull();

    fired.length = 0;
    await store.put(resumptionOpenKey('g2'), {
      openedAt: T0 - RESUMPTION_CEILING_MS - 1,
      revealingPlayId: 'timeout',
    });
    await ceiling.rearm('g2');
    expect(fired).toEqual(['g2']);
    expect(await store.read(resumptionOpenKey('g2'))).toBeNull();
  });
});
