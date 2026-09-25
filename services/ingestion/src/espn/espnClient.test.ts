import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espnClient } from './espnClient.js';

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

    it('returns an invalid_shape failure when an event is missing its id', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ events: [{ competitions: [] }] }));

      const result = await espnClient.getScoreboard();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid_shape');
    });
  });
});
