import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayEvent } from '@pivot/engine';
import type { EspnFetchResult, EspnSummary } from '@pivot/ingestion';
import { followGame } from './followGame.js';
import { InMemorySeenPlaySet, type SeenPlaySet } from './seenPlays.js';

const EVENT_ID = '401873308';

const HEADER = {
  week: 4,
  competitions: [
    {
      competitors: [
        { id: '11', homeAway: 'home' as const, team: { abbreviation: 'IND' } },
        { id: '8', homeAway: 'away' as const, team: { abbreviation: 'DET' } },
      ],
      status: { type: { state: 'in', completed: false } },
    },
  ],
};

function summary(playIds: string[], final = false): EspnSummary {
  const [competition] = HEADER.competitions;
  if (!competition) throw new Error('header needs a competition');
  return {
    header: final
      ? {
          ...HEADER,
          competitions: [{ ...competition, status: { type: { state: 'post', completed: true } } }],
        }
      : HEADER,
    drives: {
      previous: [
        {
          team: { abbreviation: 'IND' },
          plays: playIds.map((id) => ({ id, type: { id: '5' } })),
        },
      ],
    },
  };
}

function scripted(results: EspnSummary[]): {
  getSummary: (eventId: string) => Promise<EspnFetchResult<EspnSummary>>;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>> {
      calls.push(eventId);
      const data = results[Math.min(i, results.length - 1)];
      i += 1;
      if (!data) throw new Error('no summary queued');
      return { ok: true, data };
    },
  };
}

type SeedStep =
  | { ok: false; kind: 'network_error'; reason: string }
  | { ok: true; data: EspnSummary }
  | { throw: string };

/** Flushes microtasks and already-due timers without waiting on a pending backoff. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    vi.advanceTimersByTime(0);
  }
}

function scriptedSteps(steps: SeedStep[]): {
  getSummary: (eventId: string) => Promise<EspnFetchResult<EspnSummary>>;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>> {
      calls.push(eventId);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (!step) throw new Error('no step queued');
      if ('throw' in step) throw new Error(step.throw);
      return step;
    },
  };
}

describe('followGame', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips the first summary and handles a later play id once', async () => {
    const store = new InMemorySeenPlaySet();
    await store.add(EVENT_ID, 'old');
    const hasCalls: string[] = [];
    const seen: SeenPlaySet = {
      add: (eventId, playId) => store.add(eventId, playId),
      members: (eventId) => store.members(eventId),
      has: async (eventId, playId) => {
        hasCalls.push(playId);
        return store.has(eventId, playId);
      },
    };
    const handled: string[] = [];
    const client = scripted([
      summary(['p1']),
      summary(['p1']),
      summary(['old', 'p1', 'p2']),
      summary(['old', 'p1', 'p2'], true),
    ]);

    await followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen,
      signal: new AbortController().signal,
      pollIntervalMs: 0,
      onPlayEvent: async (play: PlayEvent) => {
        expect(await store.has(EVENT_ID, play.playId)).toBe(false);
        handled.push(play.playId);
      },
    });

    expect(handled).toEqual(['p2']);
    expect(await store.has(EVENT_ID, 'p2')).toBe(true);
    expect(hasCalls).toEqual(['p2']);
    expect(await store.has(EVENT_ID, 'p1')).toBe(true);
    expect(await store.has(EVENT_ID, 'old')).toBe(true);
  });

  it('stops polling when the signal aborts', async () => {
    vi.useFakeTimers();
    const client = scripted([summary(['p1'])]);
    const controller = new AbortController();
    const done = followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen: new InMemorySeenPlaySet(),
      signal: controller.signal,
      pollIntervalMs: 5_000,
      onPlayEvent: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    const callsAtAbort = client.calls.length;
    expect(callsAtAbort).toBeGreaterThan(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.calls.length).toBe(callsAtAbort);
    await done;
  });

  it('retries a failed seed twice, then polls without emitting the seeded plays', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = scriptedSteps([
      { ok: false, kind: 'network_error', reason: 'network down' },
      { throw: 'socket hang up' },
      { ok: true, data: summary(['hist']) },
      { ok: true, data: summary(['hist']) },
      { ok: true, data: summary(['hist'], true) },
    ]);
    const handled: string[] = [];
    const done = followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen: new InMemorySeenPlaySet(),
      signal: new AbortController().signal,
      pollIntervalMs: 1_000,
      onPlayEvent: async (play) => {
        handled.push(play.playId);
      },
    });

    await settle();
    expect(client.calls).toHaveLength(1);
    vi.advanceTimersByTime(9_999);
    await settle();
    expect(client.calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(client.calls).toHaveLength(2);
    vi.advanceTimersByTime(19_999);
    await settle();
    expect(client.calls).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await settle();
    expect(client.calls.length).toBeGreaterThanOrEqual(4);
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(client.calls).toHaveLength(5);
    await done;

    expect(log.mock.calls.map((call) => call[0])).toEqual([
      `[runner] seed failed ${EVENT_ID} attempt 1: network down`,
      `[runner] seed failed ${EVENT_ID} attempt 2: socket hang up`,
    ]);
    expect(client.calls.length).toBeGreaterThan(3);
    expect(handled).toEqual([]);
  });

  it('stops seed retries when the lock is lost', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = scriptedSteps([{ ok: false, kind: 'network_error', reason: 'network down' }]);
    const controller = new AbortController();
    const done = followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen: new InMemorySeenPlaySet(),
      signal: controller.signal,
      pollIntervalMs: 0,
      onPlayEvent: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(client.calls).toHaveLength(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.calls).toHaveLength(1);
    await done;
  });

  it('records a final seed and does not start polling', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const seen = new InMemorySeenPlaySet();
    const handled: string[] = [];
    const client = scriptedSteps([
      { ok: false, kind: 'network_error', reason: 'network down' },
      { ok: true, data: summary(['p1'], true) },
    ]);
    const done = followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen,
      signal: new AbortController().signal,
      pollIntervalMs: 0,
      onPlayEvent: async (play) => {
        handled.push(play.playId);
      },
    });

    await settle();
    expect(client.calls).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(client.calls).toHaveLength(2);
    await done;

    expect(client.calls).toHaveLength(2);
    expect(handled).toEqual([]);
    expect(await seen.has(EVENT_ID, 'p1')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.calls).toHaveLength(2);
  });

  it('leaves a play unmarked when handling throws and still handles the next play', async () => {
    const seen = new InMemorySeenPlaySet();
    const handled: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = scripted([
      summary(['p1']),
      summary(['p1', 'X', 'Y']),
      summary(['p1', 'X', 'Y'], true),
    ]);

    await followGame({
      eventId: EVENT_ID,
      getSummary: client.getSummary,
      seen,
      signal: new AbortController().signal,
      pollIntervalMs: 0,
      onPlayEvent: async (play) => {
        if (play.playId === 'X') throw new Error('boom');
        handled.push(play.playId);
      },
    });

    expect(handled).toEqual(['Y']);
    expect(await seen.has(EVENT_ID, 'X')).toBe(false);
    expect(await seen.has(EVENT_ID, 'Y')).toBe(true);
    expect(errors.mock.calls.map((call) => call[0])).toEqual([
      `[runner] play failed ${EVENT_ID} X: boom`,
    ]);
  });
});
