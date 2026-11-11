// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomeScreen from '../app/(app)/(tabs)/index';
import LineupScreen from '../app/(app)/(tabs)/lineup';
import { clearRememberedWatchlist, rememberWatchlist } from '../lib/lineupLoading';
import type { LineupResponse } from '../lib/leagues';
import type { MeResponse } from '../lib/me';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('../lib/fonts', () => ({ fonts: new Proxy({}, { get: () => 'sans-serif' }) }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useGlobalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../lib/useHomeRealtime', () => ({ useHomeRealtime: () => undefined }));
vi.mock('../contexts/SwitchingContext', () => ({
  useSwitching: () => ({ switchToGame: vi.fn() }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('../lib/useFeature', () => ({ useFeature: () => true }));
vi.mock('../lib/useShareCard', () => ({ useShareCard: () => ({ share: vi.fn() }) }));
vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade: vi.fn() }),
}));
vi.mock('../components/ActiveLineupPicker', () => ({ ActiveLineupPicker: () => null }));

const mocks = vi.hoisted(() => ({ get: vi.fn(), lineup: vi.fn(), me: vi.fn(), refresh: vi.fn() }));
vi.mock('../lib/apiClient', () => ({
  apiClient: { get: mocks.get },
  ApiRequestError: class extends Error {},
}));
vi.mock('../lib/me', () => ({ fetchMe: mocks.me, patchPreferences: vi.fn() }));
vi.mock('../lib/leagues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/leagues')>()),
  fetchLineup: mocks.lineup,
  fetchAllLineups: async () => [],
}));
const league = {
  league_id: 'l1',
  platform: 'manual',
  name: 'Test',
  sport: 'nfl',
  season_year: 2026,
  last_synced_at: null,
};
const leagues = [league];
vi.mock('../contexts/LeaguesGateContext', () => ({
  useLeaguesGate: () => ({
    status: 'ready',
    leagues,
    leaguesRevision: 0,
    refreshLeagues: mocks.refresh,
    deferConnect: vi.fn(),
  }),
}));
const me = {
  user_id: 'u1',
  subscription_tier: 'free',
  preferences: { watchedLeagueIds: ['l1'], watchOpponent: false },
  app_presence: [],
} as unknown as MeResponse;
const lineup = {
  league_id: 'l1',
  week: 6,
  slots: [],
  opponent: null,
} as unknown as LineupResponse;
let root: Root;
let host: HTMLDivElement;
let finish: () => void;
let reduced = true;
let motionChange: (() => void) | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  clearRememberedWatchlist();
  mocks.get.mockReset().mockImplementation(async () => ({ games: [], stakes: [], week: 6 }));
  mocks.me.mockReset().mockResolvedValue(me);
  mocks.refresh.mockReset().mockResolvedValue([league]);
  mocks.lineup.mockReset().mockResolvedValue(lineup);
  reduced = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, listener: () => void) => {
      motionChange = listener;
    },
    removeEventListener: vi.fn(),
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearRememberedWatchlist();
  vi.useRealTimers();
});
const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};
const placeholder = () => host.querySelector('[role="progressbar"]');

for (const screen of ['home', 'watchlist'] as const) {
  describe(`${screen} cold loading (real route)`, () => {
    async function mount(pending = true) {
      if (screen === 'home') {
        const state = { season: '2026', week: 6, display_phase: 'off' };
        mocks.get.mockImplementation(async (path: string) =>
          path === '/state/nfl' ? state : { games: [], stakes: [] },
        );
        if (pending)
          mocks.me.mockImplementation(
            () =>
              new Promise<MeResponse>((resolve) => {
                finish = () => resolve(me);
              }),
          );
      } else if (pending) {
        mocks.lineup.mockImplementation(
          () =>
            new Promise<LineupResponse>((resolve) => {
              finish = () => resolve(lineup);
            }),
        );
      }
      await act(async () => {
        root.render(screen === 'home' ? <HomeScreen /> : <LineupScreen />);
      });
    }
    it('delays placeholders, shows one Loading name and offers Retry at eight seconds', async () => {
      await mount();
      expect(placeholder()).toBeNull();
      await advance(149);
      expect(placeholder()).toBeNull();
      await advance(1);
      expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
      expect(placeholder()?.getAttribute('aria-label')).toBe('Loading');
      expect(host.textContent).not.toContain('stake');
      await advance(7849);
      expect(host.textContent).not.toContain('This is taking longer');
      await advance(1);
      expect(host.textContent).toContain('This is taking longer than usual.');
      const retry = Array.from(host.querySelectorAll('[role="button"]')).find(
        (el) => el.textContent === 'Retry',
      );
      await act(async () => {
        retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(mocks.refresh).toHaveBeenCalledOnce();
      await act(async () => {
        finish();
      });
      await advance(300);
      expect(host.textContent).not.toContain('This is taking longer');
      expect(placeholder()).toBeNull();
    });
    it('never flashes placeholders for immediate data', async () => {
      await mount(false);
      await advance(150);
      expect(placeholder()).toBeNull();
    });
    it('keeps a shown placeholder for at least 300ms and clears the slow message on completion', async () => {
      await mount();
      await advance(150);
      await act(async () => {
        finish();
      });
      expect(placeholder()).toBeTruthy();
      await advance(299);
      expect(placeholder()).toBeTruthy();
      await advance(1);
      expect(placeholder()).toBeNull();
    });
    it('keeps the existing error path when a cold request fails', async () => {
      const failure = new Error('offline');
      if (screen === 'home') mocks.me.mockRejectedValue(failure);
      else mocks.lineup.mockRejectedValue(failure);
      await mount(false);
      await advance(8000);
      expect(placeholder()).toBeNull();
      expect(host.textContent).not.toContain('This is taking longer');
      expect(host.textContent).toContain(
        screen === 'home' ? 'Could not load your games.' : "Couldn't load this lineup.",
      );
    });
    it('holds reduced-motion blocks still and responds to preference changes', async () => {
      await mount();
      await advance(150);
      expect(host.querySelector('[data-testid="skeleton-still"]')).toBeTruthy();
      act(() => {
        reduced = false;
        motionChange?.();
      });
      expect(host.querySelector('[data-testid="skeleton-pulse"]')).toBeTruthy();
      act(() => {
        reduced = true;
        motionChange?.();
      });
      expect(host.querySelector('[data-testid="skeleton-still"]')?.getAttribute('style')).toContain(
        'opacity: 1',
      );
    });
  });
}

it('keeps remembered Watchlist data visible during a pending refetch', async () => {
  rememberWatchlist({
    lineup,
    weekGames: [],
    bets: [],
    stakesKnown: true,
    me,
    nflWeek: 6,
    watchedStarterTotal: 0,
    watchedLeagueIds: ['l1'],
  });
  mocks.lineup.mockImplementation(() => new Promise(() => undefined));
  await act(async () => {
    root.render(<LineupScreen />);
  });
  await advance(8000);
  expect(placeholder()).toBeNull();
  expect(host.textContent).toContain('Add a pick');
  expect(host.textContent).not.toContain('This is taking longer');
});
