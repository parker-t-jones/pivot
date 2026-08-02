import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
    },
  },
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

  it('treats a 200 with an empty body as success (null)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const { apiClient } = await import('./apiClient');
    await expect(apiClient.get('/empty')).resolves.toBeNull();
  });
});
