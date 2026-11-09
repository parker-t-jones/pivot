import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  delete: vi.fn<(path: string) => Promise<unknown>>(async () => undefined),
}));
vi.mock('./apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  apiClient: api,
}));

import { deleteWatchPick, deleteWatchPickKeepalive, fetchWatchPicks } from './picksClient';
import type { ManualStake } from './stakes';

const single: ManualStake = {
  id: 'stake-1',
  season: 2026,
  week: 11,
  game_id: 'g1',
  source: 'MANUAL',
  weight: 1,
  subject: { type: 'TEAM', teamId: 't' },
  condition: { type: 'MONEYLINE' },
  game: null,
};
const parlay: ManualStake = {
  ...single,
  id: 'slip-1',
  subject: { type: 'SLIP' },
  condition: { type: 'PARLAY' },
  legs: [single],
};

describe('picks client', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads the week from GET /picks', async () => {
    api.get.mockResolvedValueOnce({
      week: 11,
      free_limit: 3,
      free_slots_used: 0,
      picks: [],
      slips: [],
    });
    await expect(fetchWatchPicks(11)).resolves.toEqual({
      week: 11,
      stakes: [],
      free_slots_spent: 0,
    });
    expect(api.get).toHaveBeenCalledWith('/picks?week=11');
  });

  it('removes a parlay with DELETE /picks/slips/:id and a single with DELETE /stakes/:id', async () => {
    await deleteWatchPick(parlay);
    await deleteWatchPick(single);
    expect(api.delete.mock.calls.map(([path]) => path)).toEqual([
      '/picks/slips/slip-1',
      '/stakes/stake-1',
    ]);
  });

  it('sends a tab-close removal of a parlay to the slip route', () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://api.example.test');
    deleteWatchPickKeepalive(parlay, 'token');
    deleteWatchPickKeepalive(single, 'token');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/picks/slips/slip-1',
      'https://api.example.test/stakes/stake-1',
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', keepalive: true });
  });
});
