import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESUMPTION_CEILING_MS, type ResumptionResolution } from '@pivot/engine';
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

function gate(
  now: { value: number },
  fireDelayMs?: (event: FlagEvent) => number | Promise<number>,
): {
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
    ...(fireDelayMs ? { fireDelayMs } : {}),
  });
  return { dispatcher, queue, records };
}

describe('ResumptionGatedDispatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
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
    expect(due[0]?.event.enqueuedAt).toBe(new Date(5_000).toISOString());
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
    expect(due).toHaveLength(1);
    const byGame = new Map(due.map((item) => [item.event.gameId, item]));
    expect(byGame.get('g1')?.event.id).toBe('high');
    expect(byGame.get('g1')?.event.newState.priorityScore).toBe(9);
    expect(byGame.get('g1')?.triggeringPlayId).toBe('play-high');
    expect(queue.size()).toBe(1);

    await dispatcher.releaseMidDrive('g2');
    const after = await queue.due(now.value, 10);
    expect(after).toHaveLength(2);
    expect(after.find((item) => item.event.gameId === 'g2')?.event.id).toBe('other');
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
      '[dispatcher] push decision user=u1 game=g1 flag=low result=collapsed anchor_play=- play_wallclock=- seen_at=- enqueued_at=- sent_at=- post_lag_ms=- send_lag_ms=-',
    ]);
    logs.mockRestore();
  });

  it('keeps a mid-drive flag_added parked through a non-real play and releases it on the next snap', async () => {
    const now = { value: 1_000 };
    const { dispatcher, queue } = gate(now);
    await dispatcher.dispatch(makeEvent({ id: 'red-zone' }), 'play-red-zone');
    expect(queue.size()).toBe(0);

    now.value = 2_000;
    dispatcher.beginPlay('g1');
    await dispatcher.endPlay('g1');
    expect(queue.size()).toBe(0);

    now.value = 8_000;
    dispatcher.beginPlay('g1');
    await dispatcher.releaseMidDrive('g1');
    await dispatcher.dispatch(makeEvent({ id: 'later' }), 'play-snap');
    await dispatcher.endPlay('g1');

    const due = await queue.due(now.value, 10);
    expect(due.map((item) => item.event.id)).toEqual(['red-zone']);
    expect(due[0]?.event.scheduledFireAt).toBe(8_000);
    expect(due[0]?.triggeringPlayId).toBe('play-red-zone');
    expect(queue.size()).toBe(1);
  });

  describe('kickoff carry-over', () => {
    /**
     * A kickoff that resolves the window. After a touchdown the scoring team's offense flag clears
     * on it; after a field goal it already cleared on the kick, so nothing is dispatched.
     */
    async function kickoff(
      dispatcher: ResumptionGatedDispatcher,
      after: 'touchdown' | 'field_goal',
    ): Promise<void> {
      dispatcher.beginPlay('g1', 'kickoff');
      dispatcher.noteWindowOpened('g1');
      await dispatcher.noteResolution('g1', realAction);
      if (after === 'field_goal') {
        await dispatcher.endPlay('g1');
        return;
      }
      await dispatcher.dispatch(
        makeEvent({
          id: 'scorer-clear',
          userId: 'u-scorer',
          type: 'flag_removed',
          newState: makeFlagState({ flagged: false, reasons: [] }),
        }),
        'play-kickoff',
      );
      await dispatcher.endPlay('g1');
    }

    it("does not spend the resolution on a flag_removed, and fires every user's first-snap flag_added", async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue, records } = gate(now);
      await kickoff(dispatcher, 'touchdown');

      now.value = 2_000;
      dispatcher.beginPlay('g1', 'run');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(makeEvent({ id: 'a', userId: 'u-a' }), 'play-snap-1');
      await dispatcher.dispatch(makeEvent({ id: 'b', userId: 'u-b' }), 'play-snap-1');
      await dispatcher.endPlay('g1');

      expect(records.map((r) => [r.event.id, r.decision, r.resolution])).toEqual([
        ['scorer-clear', 'fire_immediately', realAction],
        ['a', 'fire_immediately', realAction],
        ['b', 'fire_immediately', realAction],
      ]);
      const due = await queue.due(now.value, 10);
      expect(due.filter((item) => item.triggeringPlayId === 'play-snap-1')).toHaveLength(2);
      expect(due.find((item) => item.event.id === 'a')?.event.scheduledFireAt).toBe(2_000);
    });

    it('covers every event on the first snap, not just the first one dispatched', async () => {
      const now = { value: 1_000 };
      const { dispatcher, records } = gate(now);
      await kickoff(dispatcher, 'field_goal');

      dispatcher.beginPlay('g1', 'run');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(makeEvent({ id: 'a', userId: 'u-a' }), 'play-snap-1');
      await dispatcher.dispatch(makeEvent({ id: 'b', userId: 'u-b' }), 'play-snap-1');
      await dispatcher.endPlay('g1');

      expect(records.map((r) => [r.event.id, r.decision])).toEqual([
        ['a', 'fire_immediately'],
        ['b', 'fire_immediately'],
      ]);
    });

    it('survives a timeout, a quarter break, and a pre-snap penalty before the first snap', async () => {
      const now = { value: 1_000 };
      const { dispatcher, records } = gate(now);
      await kickoff(dispatcher, 'field_goal');

      dispatcher.beginPlay('g1', 'timeout');
      await dispatcher.endPlay('g1');
      dispatcher.beginPlay('g1', 'end_period');
      await dispatcher.endPlay('g1');
      dispatcher.beginPlay('g1', 'no_play');
      await dispatcher.endPlay('g1');

      dispatcher.beginPlay('g1', 'pass');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(makeEvent({ id: 'a' }), 'play-snap-1');
      await dispatcher.endPlay('g1');

      expect(records).toEqual([
        expect.objectContaining({
          event: expect.objectContaining({ id: 'a' }),
          decision: 'fire_immediately',
          resolution: realAction,
        }),
      ]);
    });

    it('still covers only one real play after the resolving one', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue } = gate(now);
      await kickoff(dispatcher, 'touchdown');

      // A first snap that clears a flag but pushes nothing uses up the grace play.
      dispatcher.beginPlay('g1', 'run');
      await dispatcher.dispatch(
        makeEvent({
          id: 'clear-2',
          type: 'flag_removed',
          newState: makeFlagState({ flagged: false }),
        }),
        'play-snap-1',
      );
      await dispatcher.endPlay('g1');

      dispatcher.beginPlay('g1', 'pass');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(makeEvent({ id: 'late' }), 'play-snap-2');
      await dispatcher.endPlay('g1');

      const due = await queue.due(now.value, 10);
      expect(due.map((item) => item.event.id)).not.toContain('late');
    });

    it('lets a push-eligible event on the resolving play spend the resolution', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue } = gate(now);
      dispatcher.beginPlay('g1', 'run');
      dispatcher.noteWindowOpened('g1');
      await dispatcher.noteResolution('g1', realAction);
      await dispatcher.dispatch(makeEvent({ id: 'first-snap' }), 'play-snap-1');
      await dispatcher.endPlay('g1');

      dispatcher.beginPlay('g1', 'pass');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(makeEvent({ id: 'second-snap', userId: 'u2' }), 'play-snap-2');
      await dispatcher.endPlay('g1');

      const due = await queue.due(now.value, 10);
      expect(due.map((item) => item.event.id)).toEqual(['first-snap']);
    });

    it('drops the first snap events when the carried resolution was an abort', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue, records } = gate(now);
      dispatcher.beginPlay('g1', 'kickoff');
      dispatcher.noteWindowOpened('g1');
      await dispatcher.noteResolution('g1', aborted);
      await dispatcher.endPlay('g1');

      dispatcher.beginPlay('g1', 'run');
      await dispatcher.dispatch(makeEvent({ id: 'a' }), 'play-snap-1');
      await dispatcher.endPlay('g1');

      expect(queue.size()).toBe(0);
      expect(records).toEqual([expect.objectContaining({ decision: 'dropped_by_abort' })]);
    });
  });

  it('releases a parked mid-drive event from the silence ceiling when no play arrives', async () => {
    vi.useFakeTimers();
    const now = { value: 3_000 };
    const { dispatcher, queue } = gate(now);
    await dispatcher.dispatch(makeEvent({ id: 'waiting' }), 'play-1');
    expect(queue.size()).toBe(0);

    now.value = 3_000 + RESUMPTION_CEILING_MS;
    await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS);

    const due = await queue.due(now.value, 10);
    expect(due).toHaveLength(1);
    expect(due[0]?.event.id).toBe('waiting');
    expect(due[0]?.event.scheduledFireAt).toBe(now.value);
  });
  describe('possession nudge (issue #7)', () => {
    function nudge(overrides: Partial<FlagEvent> = {}): FlagEvent {
      return makeEvent({ id: 'nudge', userId: 'u-receiver', trigger: 'possession', ...overrides });
    }

    it('fires on the punt play itself, where an untagged flag_added would wait for the next snap', async () => {
      const now = { value: 10_000 };
      const { dispatcher, queue, records } = gate(now);
      dispatcher.beginPlay('g1', 'punt');
      await dispatcher.dispatch(nudge(), 'play-punt');
      await dispatcher.dispatch(makeEvent({ id: 'plain', userId: 'u-plain' }), 'play-punt');
      await dispatcher.endPlay('g1');

      const due = await queue.due(now.value, 10);
      expect(
        due.map((item) => [item.event.id, item.triggeringPlayId, item.event.scheduledFireAt]),
      ).toEqual([['nudge', 'play-punt', 10_000]]);
      expect(records).toEqual([
        expect.objectContaining({ decision: 'nudge_immediately', holdMs: 0, resolution: null }),
      ]);
    });

    it('fires while a possession window is open, and other events stay parked', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue, records } = gate(now);
      dispatcher.noteWindowOpened('g1');
      dispatcher.beginPlay('g1', 'pass');
      await dispatcher.dispatch(nudge(), 'play-int');
      await dispatcher.dispatch(
        makeEvent({ id: 'reveal', userId: 'u-bettor', type: 'bet_in_play' }),
        'play-int',
      );
      await dispatcher.endPlay('g1');

      expect((await queue.due(now.value, 10)).map((item) => item.event.id)).toEqual(['nudge']);
      expect(records.map((record) => record.decision)).toEqual(['nudge_immediately']);

      await dispatcher.noteResolution('g1', realAction);
      expect((await queue.due(now.value, 10)).map((item) => item.event.id)).toEqual([
        'nudge',
        'reveal',
      ]);
    });

    it("leaves the kickoff's resolution for a REVEAL on the first snap", async () => {
      const now = { value: 1_000 };
      const { dispatcher, records } = gate(now);
      dispatcher.beginPlay('g1', 'kickoff');
      dispatcher.noteWindowOpened('g1');
      await dispatcher.noteResolution('g1', realAction);
      await dispatcher.dispatch(nudge(), 'play-kickoff');
      await dispatcher.endPlay('g1');

      now.value = 2_000;
      dispatcher.beginPlay('g1', 'run');
      await dispatcher.releaseMidDrive('g1');
      await dispatcher.dispatch(
        makeEvent({ id: 'reveal', userId: 'u-bettor', type: 'bet_in_play' }),
        'play-snap-1',
      );
      await dispatcher.endPlay('g1');

      expect(records.map((r) => [r.event.id, r.decision, r.resolution])).toEqual([
        ['nudge', 'nudge_immediately', null],
        ['reveal', 'fire_immediately', realAction],
      ]);
    });

    it('collapses to one push per user with the other pushes on its play', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue } = gate(now);
      dispatcher.beginPlay('g1', 'punt');
      await dispatcher.dispatch(
        nudge({ id: 'low', newState: makeFlagState({ priorityScore: 3 }) }),
        'play-punt',
      );
      await dispatcher.dispatch(
        nudge({ id: 'high', newState: makeFlagState({ priorityScore: 9 }) }),
        'play-punt',
      );
      await dispatcher.endPlay('g1');

      expect((await queue.due(now.value, 10)).map((item) => item.event.id)).toEqual(['high']);
    });

    it('does not fire a nudge-tagged flag_removed early', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue } = gate(now);
      dispatcher.beginPlay('g1', 'punt');
      await dispatcher.dispatch(
        makeEvent({
          type: 'flag_removed',
          trigger: 'possession',
          newState: makeFlagState({ flagged: false, reasons: [] }),
        }),
        'play-punt',
      );
      await dispatcher.endPlay('g1');

      expect(queue.size()).toBe(0);
    });

    it('enqueues straight away when dispatched outside a play', async () => {
      const now = { value: 7_000 };
      const { dispatcher, queue } = gate(now);
      await dispatcher.dispatch(nudge(), 'play-x');

      expect((await queue.due(now.value, 10))[0]?.event.scheduledFireAt).toBe(7_000);
    });

    it('adds the per-event fire delay to scheduledFireAt, for nudges and released events alike', async () => {
      const now = { value: 1_000 };
      const { dispatcher, queue } = gate(now, (event) =>
        event.userId === 'u-receiver' ? 30_000 : 5_000,
      );
      dispatcher.beginPlay('g1', 'punt');
      await dispatcher.dispatch(nudge(), 'play-punt');
      await dispatcher.endPlay('g1');
      dispatcher.noteWindowOpened('g1');
      await dispatcher.dispatch(makeEvent({ id: 'held', userId: 'u-other' }), 'play-held');
      await dispatcher.noteResolution('g1', realAction);

      const due = await queue.due(Number.MAX_SAFE_INTEGER, 10);
      expect(
        Object.fromEntries(due.map((item) => [item.event.id, item.event.scheduledFireAt])),
      ).toEqual({
        nudge: 31_000,
        held: 6_000,
      });
      expect(await queue.due(now.value, 10)).toHaveLength(0);
    });

    it('still lets the silence ceiling release parked events after a nudge', async () => {
      vi.useFakeTimers();
      const now = { value: 3_000 };
      const { dispatcher, queue } = gate(now);
      dispatcher.beginPlay('g1', 'punt');
      await dispatcher.dispatch(nudge(), 'play-punt');
      await dispatcher.dispatch(
        makeEvent({ id: 'reveal', userId: 'u-bettor', type: 'bet_in_play' }),
        'play-punt',
      );
      await dispatcher.endPlay('g1');
      expect((await queue.due(now.value, 10)).map((item) => item.event.id)).toEqual(['nudge']);

      now.value = 3_000 + RESUMPTION_CEILING_MS;
      await vi.advanceTimersByTimeAsync(RESUMPTION_CEILING_MS);

      expect((await queue.due(now.value, 10)).map((item) => item.event.id)).toEqual([
        'nudge',
        'reveal',
      ]);
    });
  });
});
