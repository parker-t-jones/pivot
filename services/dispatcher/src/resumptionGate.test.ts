import { describe, expect, it, vi } from 'vitest';
import type { ResumptionResolution } from '@pivot/engine';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { ResumptionGatedDispatcher, type GatedEventRecord } from './resumptionGate.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  const newState = overrides.newState ?? makeFlagState();
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: newState.gameId,
    type: 'flag_added',
    oldState: null,
    newState,
    scheduledFireAt: 0,
    ...overrides,
  };
}

const realAction = { outcome: 'REAL_ACTION' } as ResumptionResolution;
const aborted = { outcome: 'ABORTED' } as ResumptionResolution;

function gate(now: { value: number }): {
  dispatcher: ResumptionGatedDispatcher;
  queue: InMemoryFlagEventQueue;
  records: GatedEventRecord[];
} {
  const queue = new InMemoryFlagEventQueue();
  const records: GatedEventRecord[] = [];
  const dispatcher = new ResumptionGatedDispatcher({
    queue,
    onGated: (record) => records.push(record),
    clock: () => now.value,
  });
  return { dispatcher, queue, records };
}

describe('ResumptionGatedDispatcher', () => {
  it('fires immediately when the same play opens and resolves the window', async () => {
    const now = { value: 5_000 };
    const { dispatcher, queue, records } = gate(now);
    dispatcher.beginPlay('g1');
    dispatcher.noteWindowOpened('g1');
    await dispatcher.noteResolution('g1', realAction);

    await dispatcher.dispatch(makeEvent(), 'play-9');
    await dispatcher.endPlay('g1');

    expect(records).toEqual([
      expect.objectContaining({ decision: 'fire_immediately', holdMs: 0, resolution: realAction }),
    ]);
    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.scheduledFireAt).toBe(5_000);
    expect(due[0]?.triggeringPlayId).toBe('play-9');
  });

  it('releases a parked event when the window resolves, scheduled for now', async () => {
    const now = { value: 1_000 };
    const { dispatcher, queue, records } = gate(now);
    dispatcher.noteWindowOpened('g1');
    await dispatcher.dispatch(makeEvent(), 'play-held');
    expect(queue.size()).toBe(0);
    expect(records).toHaveLength(0);

    now.value = 4_000;
    await dispatcher.noteResolution('g1', realAction);

    expect(records).toEqual([
      expect.objectContaining({
        decision: 'held_pending_resumption',
        holdMs: 3_000,
        resolution: realAction,
      }),
    ]);
    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.scheduledFireAt).toBe(4_000);
    expect(due[0]?.triggeringPlayId).toBe('play-held');
  });

  it('drops a parked event when the window aborts', async () => {
    const now = { value: 1_000 };
    const { dispatcher, queue, records } = gate(now);
    dispatcher.noteWindowOpened('g1');
    await dispatcher.dispatch(makeEvent());

    await dispatcher.noteResolution('g1', aborted);

    expect(queue.size()).toBe(0);
    expect(records).toEqual([
      expect.objectContaining({ decision: 'dropped_by_abort', resolution: aborted }),
    ]);
  });

  it('collapses two events for one user and game in a window, and leaves another game alone', async () => {
    const now = { value: 5_000 };
    const { dispatcher, queue } = gate(now);
    dispatcher.beginPlay('g1');
    dispatcher.noteWindowOpened('g1');
    await dispatcher.noteResolution('g1', realAction);

    await dispatcher.dispatch(
      makeEvent({ id: 'low', newState: makeFlagState({ priorityScore: 2 }) }),
      'play-low',
    );
    await dispatcher.dispatch(
      makeEvent({ id: 'high', newState: makeFlagState({ priorityScore: 9 }) }),
      'play-high',
    );
    await dispatcher.dispatch(
      makeEvent({
        id: 'other',
        gameId: 'g2',
        newState: makeFlagState({ gameId: 'g2', priorityScore: 100 }),
      }),
      'play-other',
    );
    await dispatcher.endPlay('g1');

    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(2);
    const byGame = new Map(due.map((item) => [item.event.gameId, item]));
    expect(byGame.get('g1')?.event.id).toBe('high');
    expect(byGame.get('g1')?.event.newState.priorityScore).toBe(9);
    expect(byGame.get('g1')?.triggeringPlayId).toBe('play-high');
    expect(byGame.get('g2')?.event.id).toBe('other');
  });

  it('collapses a parked window to the higher priorityScore', async () => {
    const now = { value: 4_000 };
    const { dispatcher, queue } = gate(now);
    dispatcher.noteWindowOpened('g1');
    await dispatcher.dispatch(
      makeEvent({ id: 'low', newState: makeFlagState({ priorityScore: 2 }) }),
    );
    await dispatcher.dispatch(
      makeEvent({ id: 'high', newState: makeFlagState({ priorityScore: 8 }) }),
    );

    await dispatcher.noteResolution('g1', realAction);

    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.id).toBe('high');
    expect(due[0]?.event.newState.priorityScore).toBe(8);
  });

  it('merges events parked during the window with events from the play that resolves it', async () => {
    const now = { value: 6_000 };
    const { dispatcher, queue } = gate(now);
    dispatcher.beginPlay('g1');
    dispatcher.noteWindowOpened('g1');
    await dispatcher.dispatch(
      makeEvent({ id: 'parked', newState: makeFlagState({ priorityScore: 4 }) }),
    );
    await dispatcher.noteResolution('g1', realAction);
    await dispatcher.dispatch(
      makeEvent({ id: 'resolving', newState: makeFlagState({ priorityScore: 7 }) }),
    );
    await dispatcher.endPlay('g1');

    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.id).toBe('resolving');
  });

  it('delivers a flag clear and only collapses push-eligible events', async () => {
    const now = { value: 5_000 };
    const { dispatcher, queue } = gate(now);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dispatcher.beginPlay('g1');
    dispatcher.noteWindowOpened('g1');
    await dispatcher.noteResolution('g1', realAction);

    await dispatcher.dispatch(
      makeEvent({ id: 'low', newState: makeFlagState({ priorityScore: 2 }) }),
    );
    await dispatcher.dispatch(
      makeEvent({
        id: 'clear',
        type: 'flag_removed',
        newState: makeFlagState({ priorityScore: 100, flagged: false, reasons: [] }),
      }),
    );
    await dispatcher.dispatch(
      makeEvent({ id: 'high', newState: makeFlagState({ priorityScore: 9 }) }),
    );
    await dispatcher.endPlay('g1');

    const due = await queue.due(now.value, 10);
    expect(due.map((item) => item.event.id).sort()).toEqual(['clear', 'high']);
    expect(due.find((item) => item.event.id === 'clear')?.event.type).toBe('flag_removed');
    expect(logs.mock.calls.map((call) => call[0])).toEqual([
      '[gate] collapsed flag_added g1 for u1 into flag_added',
    ]);
    logs.mockRestore();
  });
});
