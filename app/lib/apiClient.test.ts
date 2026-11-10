import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOutMock = vi.fn(async () => ({ error: null }));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
      signOut: signOutMock,
    },
  },
}));

const alertAsyncMock = vi.fn(async () => undefined);

vi.mock('./confirm', () => ({
  alertAsync: alertAsyncMock,
}));

describe('apiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://api.test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    signOutMock.mockClear();
    alertAsyncMock.mockClear();
  });

  it('treats a 204 with no body as success without calling JSON.parse', async () => {
    const jsonParseSpy = vi.spyOn(JSON, 'parse');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => {
        throw new Error('body should not be read for 204');
      },
    });

    const { apiClient } = await import('./apiClient');
    await expect(apiClient.delete('/leagues/abc')).resolves.toBeUndefined();
    expect(jsonParseSpy).not.toHaveBeenCalled();
    jsonParseSpy.mockRestore();
  });

  it('omits Content-Type on DELETE with no body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' });

    const { apiClient } = await import('./apiClient');
    await apiClient.delete('/leagues/abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/leagues/abc',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
        body: undefined,
      }),
    );
  });

  it('sets Content-Type only when a JSON body is sent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const { apiClient } = await import('./apiClient');
    await apiClient.post('/leagues/manual', { name: 'Test', season_year: 2026 });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/leagues/manual',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test', season_year: 2026 }),
      }),
    );
  });

  it('omits Content-Type on POST with no body (e.g. sync)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ league_id: 'x', week: 1, slot_count: 0 }),
    });

    const { apiClient } = await import('./apiClient');
    await apiClient.post('/leagues/abc/sync');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/leagues/abc/sync',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: undefined,
      }),
    );
  });

  it('treats a 200 with an empty body as success (null)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const { apiClient } = await import('./apiClient');
    await expect(apiClient.get('/empty')).resolves.toBeNull();
  });

  it('Issue #46: signs out and alerts, rather than retrying, on account_not_found', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'account_not_found',
            message: "Your account isn't available anymore. Please sign in again.",
          },
        }),
    });

    const { apiClient, ApiRequestError } = await import('./apiClient');
    const call = apiClient.get('/me');

    await expect(call).rejects.toMatchObject({
      status: 401,
      code: 'account_not_found',
    });
    await expect(call).rejects.toBeInstanceOf(ApiRequestError);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(alertAsyncMock).toHaveBeenCalledWith(
      "You're signed out",
      "Your account isn't available anymore. Please sign in again.",
    );
  });

  it('does not sign out for an unrelated error code', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: { code: 'league_limit_free', message: 'Upgrade to Pro.' } }),
    });

    const { apiClient } = await import('./apiClient');
    await expect(apiClient.get('/leagues')).rejects.toMatchObject({ code: 'league_limit_free' });
    expect(signOutMock).not.toHaveBeenCalled();
    expect(alertAsyncMock).not.toHaveBeenCalled();
  });
});
