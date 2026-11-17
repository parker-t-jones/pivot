// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// iOS is the platform where the stack has no header, so the screen's own Close is the only way out.
vi.mock('react-native', async () => {
  const web = await import('react-native-web');
  return { ...web, Platform: { ...web.Platform, OS: 'ios' } };
});
const router = vi.hoisted(() => ({ back: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
        error: null,
      })),
    },
  },
}));
vi.mock('../lib/confirm', () => ({ alertAsync: vi.fn() }));
// Keep unrelated picks mutations (and their Expo dependencies) out of this screen test.
vi.mock('../lib/picksClient', async () => {
  const { apiClient } = await import('../lib/apiClient');
  return { fetchRecap: () => apiClient.get('/picks/recap') };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  router.back.mockClear();
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
  const { default: RecapScreen } = await import('../app/(app)/recap');

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

it('shows a Close button on iOS that goes back', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
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
    }),
  );
  const { default: RecapScreen } = await import('../app/(app)/recap');

  await act(async () => root.render(<RecapScreen />));
  const close = container.querySelector<HTMLElement>('[role="button"][aria-label="Close"]');
  expect(close).not.toBeNull();

  await act(async () => close?.click());
  expect(router.back).toHaveBeenCalledTimes(1);
});

const EMPTY_TOTALS = {
  picks_made: 0,
  won: 0,
  lost: 0,
  tie: 0,
  void: 0,
  decided: 0,
  hit_rate: null,
  best: null,
  worst: null,
};

function summary(id: string, label: string, result: string) {
  return { id, label, result, result_value: null, game_id: 'g1', slip_id: null };
}

const GIBBS = summary('gibbs', 'J. Gibbs over 120.5 rush + rec yds', 'won');
const DET = summary('det', 'DET -3.5', 'lost');
const HISTORY = {
  week: 10,
  season: 2026,
  week_recap: { ...EMPTY_TOTALS, picks_made: 2, won: 1, lost: 1, decided: 2, hit_rate: 0.5 },
  season_recap: { won: 2, decided: 3, hit_rate: 2 / 3 },
  weeks: [
    {
      ...EMPTY_TOTALS,
      week: 10,
      picks_made: 2,
      won: 1,
      lost: 1,
      decided: 2,
      hit_rate: 0.5,
      best: GIBBS,
      worst: DET,
      picks: [GIBBS, DET],
    },
    {
      ...EMPTY_TOTALS,
      week: 9,
      picks_made: 1,
      won: 1,
      decided: 1,
      hit_rate: 1,
      best: summary('phi', 'PHI ML', 'won'),
      picks: [summary('phi', 'PHI ML', 'won')],
    },
  ],
};

function okFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
}

it('shows a skeleton while the recap loads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => undefined)),
  );
  const { default: RecapScreen } = await import('../app/(app)/recap');

  await act(async () => root.render(<RecapScreen />));
  expect(container.querySelector('[data-testid="recap-loading"]')).not.toBeNull();
  expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
});

it('shows the season line, then every past week with the most recent one open', async () => {
  vi.stubGlobal('fetch', okFetch(HISTORY));
  const { default: RecapScreen } = await import('../app/(app)/recap');

  await act(async () => root.render(<RecapScreen />));
  expect(container.querySelector('[data-testid="recap-season-line"]')?.textContent).toBe(
    '2 of 3 hit this season (67%)',
  );
  const weeks = Array.from(container.querySelectorAll('[data-testid^="recap-week-"]')).filter(
    (node) => /^recap-week-\d+$/.test(node.getAttribute('data-testid') ?? ''),
  );
  expect(weeks.map((node) => node.getAttribute('data-testid'))).toEqual([
    'recap-week-10',
    'recap-week-9',
  ]);

  const week10 = container.querySelector('[data-testid="recap-week-10"]');
  const week9 = container.querySelector('[data-testid="recap-week-9"]');
  expect(week10?.querySelector('[data-testid="recap-week-body"]')).not.toBeNull();
  expect(week10?.querySelector('[data-testid="recap-best"]')?.textContent).toBe(
    'J. Gibbs over 120.5 rush + rec yds · Won',
  );
  expect(week10?.querySelector('[data-testid="recap-worst"]')?.textContent).toBe('DET -3.5 · Lost');
  expect(week10?.querySelector('[data-testid="recap-pick-det"]')?.textContent).toBe('DET -3.5Lost');
  expect(week9?.querySelector('[data-testid="recap-week-body"]')).toBeNull();
  expect(week9?.querySelector('[data-testid="recap-week-line"]')?.textContent).toBe(
    '1 of 1 hit (100%)',
  );

  // Expanding an older week leaves the newest open; collapsing the newest closes only it.
  const toggle9 = week9?.querySelector<HTMLElement>('[data-testid="recap-week-toggle"]');
  await act(async () => toggle9?.click());
  expect(week9?.querySelector('[data-testid="recap-pick-phi"]')?.textContent).toBe('PHI MLWon');
  expect(week10?.querySelector('[data-testid="recap-week-body"]')).not.toBeNull();

  const toggle10 = week10?.querySelector<HTMLElement>('[data-testid="recap-week-toggle"]');
  await act(async () => toggle10?.click());
  expect(week10?.querySelector('[data-testid="recap-week-body"]')).toBeNull();
  expect(week9?.querySelector('[data-testid="recap-week-body"]')).not.toBeNull();
  expect(container.textContent).not.toMatch(/push|stake/i);
});

it('shows the empty state when nothing has been graded all season', async () => {
  vi.stubGlobal(
    'fetch',
    okFetch({
      ...HISTORY,
      week_recap: EMPTY_TOTALS,
      season_recap: { won: 0, decided: 0, hit_rate: null },
      weeks: [],
    }),
  );
  const { default: RecapScreen } = await import('../app/(app)/recap');

  await act(async () => root.render(<RecapScreen />));
  expect(container.textContent).toContain('Nothing graded yet');
  expect(container.querySelector('[data-testid="recap-season"]')).toBeNull();
});
