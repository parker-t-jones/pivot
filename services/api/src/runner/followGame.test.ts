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

describe('followGame', () => {
  afterEach(() => {
    vi.useRealTimers();
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
        expect(await store.has(EVENT_ID, play.playId)).toBe(true);
        handled.push(play.playId);
      },
    });

    expect(handled).toEqual(['p2']);
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
});
