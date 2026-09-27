import { describe, expect, it } from 'vitest';
import type { ResumptionResolution } from '@pivot/engine';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { ResumptionGatedDispatcher, type GatedEventRecord } from './resumptionGate.js';

function makeFlagState(): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_000,
  };
}

function makeEvent(): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 0,
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
});
