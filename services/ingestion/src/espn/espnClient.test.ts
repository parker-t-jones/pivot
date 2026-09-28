import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espnClient } from './espnClient.js';
import { EspnPlaySource } from './espnPlaySource.js';

function jsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

const VALID_SUMMARY = {
  header: {
    week: 4,
    competitions: [
      {
        competitors: [
          { id: '11', homeAway: 'home', team: { abbreviation: 'IND' } },
          { id: '8', homeAway: 'away', team: { abbreviation: 'DET' } },
        ],
        status: { type: { state: 'in' } },
      },
    ],
  },
  drives: {
    previous: [
      {
        team: { abbreviation: 'IND' },
        plays: [{ id: 'p1', type: { id: '5' } }],
      },
    ],
  },
};

const VALID_SCOREBOARD = {
  events: [
    {
      id: '401873308',
      competitions: [
        {
          competitors: [
            { id: '11', homeAway: 'home', team: { abbreviation: 'IND' } },
            { id: '8', homeAway: 'away', team: { abbreviation: 'DET' } },
          ],
        },
      ],
      status: { type: { state: 'post', completed: true } },
    },
  ],
};

describe('espnClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('getSummary', () => {
    it('returns ok:true with the parsed data on a valid response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(VALID_SUMMARY));

      const result = await espnClient.getSummary('401873308');

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873308',
        { signal: expect.any(AbortSignal) },
      );
      if (result.ok) {
        expect(result.data.header?.week).toBe(4);
      }
    });

    it('returns a network_error failure when fetch itself rejects, without throwing', async () => {
      fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

      const result = await espnClient.getSummary('401873308');

      expect(result).toEqual({
        ok: false,
        kind: 'network_error',
        reason: 'ESPN request threw: getaddrinfo ENOTFOUND',
      });
    });

    it('returns an http_error failure on a non-2xx response, without throwing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503, 'Service Unavailable'));

      const result = await espnClient.getSummary('401873308');

      expect(result).toEqual({
        ok: false,
        kind: 'http_error',
        reason: 'ESPN request failed: 503 Service Unavailable',
      });
    });

    it('returns an invalid_shape failure with zod issues when a play is missing its id', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          drives: { previous: [{ plays: [{ type: { id: '5' } }] }] },
        }),
      );

      const result = await espnClient.getSummary('401873308');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('invalid_shape');
        expect(Array.isArray(result.issues)).toBe(true);
      }
    });

    it('aborts a body that never finishes and that game backs off', async () => {
      vi.useFakeTimers();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let fetchCalls = 0;
      fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: () =>
              new Promise((_resolve, reject) => {
                const abort = (): void => {
                  const error = new Error('The operation was aborted');
                  error.name = 'AbortError';
                  reject(error);
                };
                if (init?.signal?.aborted) abort();
                else init?.signal?.addEventListener('abort', abort, { once: true });
              }),
          } as Response);
        }
        return Promise.resolve(
          jsonResponse({
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
              previous: [
                { team: { abbreviation: 'IND' }, plays: [{ id: 'p1', type: { id: '5' } }] },
              ],
            },
          }),
        );
      });

      const source = new EspnPlaySource({ eventId: '401873308', pollIntervalMs: 0 });
      const done = source.subscribe(async () => undefined);

      try {
        expect(fetchCalls).toBe(1);
        vi.advanceTimersByTime(7_999);
        expect(fetchCalls).toBe(1);
        vi.advanceTimersByTime(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchCalls).toBe(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('ESPN request aborted after 8000ms'),
        );
        await vi.advanceTimersByTimeAsync(9_999);
        expect(fetchCalls).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await done;
        expect(fetchCalls).toBe(2);
      } finally {
        consoleErrorSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('strips fields not declared in the schema rather than rejecting them', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ...VALID_SUMMARY,
          somethingEspnAddedLater: { nested: true },
        }),
      );

      const result = await espnClient.getSummary('401873308');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).not.toHaveProperty('somethingEspnAddedLater');
      }
    });
  });

  describe('getScoreboard', () => {
    it('returns ok:true with the parsed data on a valid response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(VALID_SCOREBOARD));

      const result = await espnClient.getScoreboard();

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
        { signal: expect.any(AbortSignal) },
      );
      if (result.ok) {
        expect(result.data.events?.[0]?.id).toBe('401873308');
      }
    });

    it('requests a specific season, season type and week when given one', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(VALID_SCOREBOARD))
        .mockResolvedValueOnce(jsonResponse(VALID_SCOREBOARD));

      await espnClient.getScoreboard({ seasonYear: 2026, seasonType: 'regular', week: 2 });
      await espnClient.getScoreboard({ seasonYear: 2027, seasonType: 'post', week: 1 });

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=2',
        { signal: expect.any(AbortSignal) },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2027&seasontype=3&week=1',
        { signal: expect.any(AbortSignal) },
      );
    });

    it('returns an invalid_shape failure when an event is missing its id', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ events: [{ competitions: [] }] }));

      const result = await espnClient.getScoreboard();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid_shape');
    });

    it('keeps the broadcast fields parseEspnAirings reads', async () => {
      const geo = {
        type: { shortName: 'TV' },
        market: { type: 'National' },
        media: { shortName: 'NBC' },
      };
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              id: '1',
              shortName: 'LAR @ DEN',
              date: '2026-09-28T00:20Z',
              competitions: [
                {
                  broadcast: 'NBC',
                  broadcasts: [{ market: 'national', names: ['NBC'] }],
                  geoBroadcasts: [geo],
                },
              ],
            },
          ],
        }),
      );

      const result = await espnClient.getScoreboard();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.events?.[0]).toMatchObject({
          shortName: 'LAR @ DEN',
          date: '2026-09-28T00:20Z',
          competitions: [
            {
              broadcast: 'NBC',
              broadcasts: [{ market: 'national', names: ['NBC'] }],
              geoBroadcasts: [geo],
            },
          ],
        });
      }
    });

    it('drops a malformed broadcast block instead of failing the scoreboard', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          events: [
            {
              id: '1',
              competitions: [{ geoBroadcasts: 'not-a-list', broadcasts: [{ names: 7 }] }],
            },
          ],
        }),
      );

      const result = await espnClient.getScoreboard();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.events?.[0]?.competitions?.[0]?.geoBroadcasts).toBeUndefined();
        expect(result.data.events?.[0]?.competitions?.[0]?.broadcasts).toBeUndefined();
      }
    });
  });
});
