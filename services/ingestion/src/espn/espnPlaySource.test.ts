import { describe, expect, it, vi } from 'vitest';
import type { PlayEvent } from '@pivot/engine';
import type { ErrorReporter } from '@pivot/shared';
import { EspnPlaySource } from './espnPlaySource.js';
import type { EspnClient, EspnFetchResult } from './espnClient.js';
import type { EspnSummary } from './espnTypes.js';

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

const [headerCompetition] = HEADER.competitions;
if (!headerCompetition) throw new Error('HEADER must have at least one competition');

function finalHeader(): EspnSummary['header'] {
  return {
    ...HEADER,
    competitions: [{ ...headerCompetition, status: { type: { state: 'post', completed: true } } }],
  };
}

function summary(overrides: Partial<EspnSummary> = {}): EspnSummary {
  return { header: HEADER, drives: { previous: [] }, ...overrides };
}

/** A fake `EspnClient` that returns one queued result per `getSummary` call, and records every
 *  eventId it was called with — mirrors `makeFakeExpo` in `pushNotifier.test.ts`. */
function makeFakeClient(results: EspnFetchResult<EspnSummary>[]): {
  client: Pick<EspnClient, 'getSummary'>;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    client: {
      async getSummary(eventId: string): Promise<EspnFetchResult<EspnSummary>> {
        calls.push(eventId);
        const result = results[Math.min(i, results.length - 1)];
        i += 1;
        if (!result) throw new Error('makeFakeClient: no result queued');
        return result;
      },
    },
  };
}

/** Failure retries wait `5s * 2^failures` (10s the first time). Fake timers skip that wait. */
async function subscribeThroughBackoff(
  source: EspnPlaySource,
  handler: (play: PlayEvent) => Promise<void>,
): Promise<void> {
  vi.useFakeTimers();
  try {
    const done = source.subscribe(handler);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
  } finally {
    vi.useRealTimers();
  }
}

function makeCapturingReporter(): { reporter: ErrorReporter; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { reporter: { captureException: (...args) => calls.push(args) }, calls };
}

describe('EspnPlaySource', () => {
  it('emits normalized plays in order and stops once the game is final', async () => {
    const { client } = makeFakeClient([
      {
        ok: true,
        data: summary({
          drives: {
            previous: [
              {
                team: { abbreviation: 'IND' },
                plays: [
                  { id: 'p1', type: { id: '53' } },
                  { id: 'p2', type: { id: '5' } },
                ],
              },
            ],
          },
          header: finalHeader(),
        }),
      },
    ]);

    const seen: PlayEvent[] = [];
    const source = new EspnPlaySource({ eventId: '401873308', pollIntervalMs: 0, client });
    await source.subscribe(async (play) => {
      seen.push(play);
    });

    expect(seen.map((p) => p.playId)).toEqual(['p1', 'p2']);
    const [first, second] = seen;
    expect(first?.isFinalPlay).toBe(false);
    expect(second?.isFinalPlay).toBe(true);
  });

  it('never re-emits a play id already seen in an earlier poll', async () => {
    const { client } = makeFakeClient([
      {
        ok: true,
        data: summary({
          drives: {
            previous: [
              { team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '53' } }] },
            ],
          },
        }),
      },
      {
        ok: true,
        data: summary({
          drives: {
            previous: [
              {
                team: { abbreviation: 'IND' },
                plays: [
                  { id: 'p1', type: { id: '53' } },
                  { id: 'p2', type: { id: '5' } },
                ],
              },
            ],
          },
          header: finalHeader(),
        }),
      },
    ]);

    const seen: string[] = [];
    const source = new EspnPlaySource({ eventId: '401873308', pollIntervalMs: 0, client });
    await source.subscribe(async (play) => {
      seen.push(play.playId);
    });

    expect(seen).toEqual(['p1', 'p2']);
  });

  it('reports a shape failure and keeps polling on an invalid_shape result, without crashing', async () => {
    const { client, calls } = makeFakeClient([
      {
        ok: false,
        kind: 'invalid_shape',
        reason: 'response did not match the expected shape',
        issues: [],
      },
      {
        ok: true,
        data: summary({
          drives: {
            previous: [{ team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] }],
          },
          header: finalHeader(),
        }),
      },
    ]);
    const { reporter, calls: reporterCalls } = makeCapturingReporter();

    const seen: string[] = [];
    const source = new EspnPlaySource({
      eventId: '401873308',
      pollIntervalMs: 0,
      client,
      errorReporter: reporter,
    });
    await subscribeThroughBackoff(source, async (play) => {
      seen.push(play.playId);
    });

    expect(calls).toEqual(['401873308', '401873308']);
    expect(reporterCalls).toHaveLength(1);
    expect(seen).toEqual(['p1']);
  });

  it('logs and retries on a network_error result without calling the error reporter', async () => {
    const { client } = makeFakeClient([
      { ok: false, kind: 'network_error', reason: 'ESPN request threw: fetch failed' },
      {
        ok: true,
        data: summary({
          drives: {
            previous: [{ team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] }],
          },
          header: finalHeader(),
        }),
      },
    ]);
    const { reporter, calls: reporterCalls } = makeCapturingReporter();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const source = new EspnPlaySource({
      eventId: '401873308',
      pollIntervalMs: 0,
      client,
      errorReporter: reporter,
    });
    await subscribeThroughBackoff(source, async () => undefined);

    expect(reporterCalls).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ESPN request threw: fetch failed'),
    );
    consoleErrorSpy.mockRestore();
  });

  it('reports a shape failure and retries when the header never identifies both teams', async () => {
    const { client } = makeFakeClient([
      { ok: true, data: summary({ header: { week: 4, competitions: [] } }) },
      {
        ok: true,
        data: summary({
          drives: {
            previous: [{ team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] }],
          },
          header: finalHeader(),
        }),
      },
    ]);
    const { reporter, calls: reporterCalls } = makeCapturingReporter();

    const seen: string[] = [];
    const source = new EspnPlaySource({
      eventId: '401873308',
      pollIntervalMs: 0,
      client,
      errorReporter: reporter,
    });
    await subscribeThroughBackoff(source, async (play) => {
      seen.push(play.playId);
    });

    expect(reporterCalls).toHaveLength(1);
    expect(seen).toEqual(['p1']);
  });

  it('stops emitting once disconnected, even mid-poll', async () => {
    const { client } = makeFakeClient([
      {
        ok: true,
        data: summary({
          drives: {
            previous: [
              {
                team: { abbreviation: 'IND' },
                plays: [
                  { id: 'p1', type: { id: '53' } },
                  { id: 'p2', type: { id: '5' } },
                  { id: 'p3', type: { id: '5' } },
                ],
              },
            ],
          },
        }),
      },
    ]);

    const seen: string[] = [];
    const source = new EspnPlaySource({ eventId: '401873308', pollIntervalMs: 0, client });
    const subscription = source.subscribe(async (play) => {
      seen.push(play.playId);
      if (play.playId === 'p2') await source.disconnect();
    });
    await subscription;

    expect(seen).toEqual(['p1', 'p2']);
  });

  it('reports the id "espn"', () => {
    expect(new EspnPlaySource({ eventId: '1' }).id).toBe('espn');
  });

  it('aborts a fetch that never resolves and then polls again', async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fetchCalls = 0;
    vi.stubGlobal('fetch', (_url: string, init?: { signal?: AbortSignal }) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const abort = (): void => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          header: {
            week: 4,
            competitions: [
              {
                competitors: [
                  { id: '11', homeAway: 'home', team: { abbreviation: 'IND' } },
                  { id: '8', homeAway: 'away', team: { abbreviation: 'DET' } },
                ],
                status: { type: { state: 'post', completed: true } },
              },
            ],
          },
          drives: {
            previous: [{ team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] }],
          },
        }),
      } as Response);
    });

    const seen: string[] = [];
    const source = new EspnPlaySource({ eventId: '401873308', pollIntervalMs: 0 });
    const done = source.subscribe(async (play) => {
      seen.push(play.playId);
    });

    try {
      expect(fetchCalls).toBe(1);
      vi.advanceTimersByTime(7_999);
      expect(fetchCalls).toBe(1);
      vi.advanceTimersByTime(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
      expect(fetchCalls).toBe(2);
      expect(seen).toEqual(['p1']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ESPN request aborted after 8000ms'),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("does not let one game's failures increase the other game's backoff", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = { a: 0, b: 0 };
    const failure: EspnFetchResult<EspnSummary> = {
      ok: false,
      kind: 'network_error',
      reason: 'down',
    };
    const success: EspnFetchResult<EspnSummary> = {
      ok: true,
      data: summary({
        drives: {
          previous: [{ team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] }],
        },
        header: finalHeader(),
      }),
    };
    const sourceA = new EspnPlaySource({
      eventId: '401873308',
      pollIntervalMs: 0,
      client: {
        async getSummary(): Promise<EspnFetchResult<EspnSummary>> {
          calls.a += 1;
          return calls.a < 3 ? failure : success;
        },
      },
    });
    const sourceB = new EspnPlaySource({
      eventId: '401873309',
      pollIntervalMs: 0,
      client: {
        async getSummary(): Promise<EspnFetchResult<EspnSummary>> {
          calls.b += 1;
          return calls.b < 2 ? failure : success;
        },
      },
    });
    const doneA = sourceA.subscribe(async () => undefined);
    const doneB = sourceB.subscribe(async () => undefined);

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual({ a: 1, b: 1 });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toEqual({ a: 2, b: 2 });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls.a).toBe(2);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls.a).toBe(3);
      await doneA;
      await doneB;
    } finally {
      consoleErrorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
