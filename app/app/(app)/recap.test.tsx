// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
    },
  },
}));
vi.mock('../../lib/confirm', () => ({ alertAsync: vi.fn() }));
// Keep unrelated picks mutations (and their Expo dependencies) out of this screen test.
vi.mock('../../lib/picksClient', async () => {
  const { apiClient } = await import('../../lib/apiClient');
  return { fetchRecap: () => apiClient.get('/picks/recap') };
});
vi.mock('../../components/LoadingState', () => ({
  LoadingState: ({ message }: { message: string }) => <div>{message}</div>,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://api.test');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('renders the unavailable sentence in ErrorState and retries the recap request', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          message: 'Route GET:/picks/recap not found',
          error: 'Not Found',
          statusCode: 404,
        }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          week: 9,
          season: 2026,
          week_recap: {
            picks_made: 0,
            won: 0,
            lost: 0,
            tie: 0,
            void: 0,
            decided: 0,
            hit_rate: null,
            best: null,
            worst: null,
          },
          season_recap: { won: 0, decided: 0, hit_rate: null },
        }),
    });
  vi.stubGlobal('fetch', fetchMock);
  const { default: RecapScreen } = await import('./recap');

  await act(async () => root.render(<RecapScreen />));
  expect(container.textContent).toContain(
    "This isn't available yet. Please try again in a little while.",
  );
  expect(container.textContent).not.toContain('Request failed with status 404.');
  const retry = container.querySelector<HTMLElement>('[role="button"][aria-label="Retry"]');
  expect(retry).not.toBeNull();

  await act(async () => retry?.click());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith('http://api.test/picks/recap', expect.any(Object));
  expect(container.textContent).toContain('Nothing graded yet');
  expect(container.textContent).not.toContain("This isn't available yet.");
});
