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
    await source.subscribe(async (play) => {
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
    await source.subscribe(async () => undefined);

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
    await source.subscribe(async (play) => {
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
});
