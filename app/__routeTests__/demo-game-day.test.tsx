// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DemoGameDayScreen from '../app/(app)/demo-game-day';
import { PICK_FLASH_MS } from '../components/PickEventFlash';
import { DEMO_HIT_AT_MS, DEMO_PRE_GAME_MS, DEMO_TOTAL_MS } from '../lib/demoGameDay';

vi.mock('react-native', () => import('react-native-web'));

const router = vi.hoisted(() => ({
  dismissTo: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('expo-router', () => ({
  useRouter: () => router,
}));

const scheduleDemoNotification = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/demoGameDayNotification', () => ({
  scheduleDemoGameDayNotificationAsync: scheduleDemoNotification,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  router.dismissTo.mockClear();
  router.replace.mockClear();
  scheduleDemoNotification.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('DemoGameDayScreen', () => {
  it('starts pre-game, flips to live with one scheduled notification, then completes', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    expect(container.textContent).toContain('Kickoff in');
    expect(scheduleDemoNotification).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS + 500);
    });
    expect(container.textContent).toContain('LIVE');
    expect(scheduleDemoNotification).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(scheduleDemoNotification).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(DEMO_TOTAL_MS);
    });
    expect(container.textContent).toContain('Demo complete');
    expect(scheduleDemoNotification).toHaveBeenCalledTimes(1);
  });

  it('renders the real pick cards and plays the Watchlist pick-hit flash once when the prop hits', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    const flash = () => container.querySelector('[data-testid="pick-event-flash"]');

    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS + 500);
    });
    expect(container.querySelectorAll('[data-testid="pick-card-live"]')).toHaveLength(2);
    expect(container.textContent).toContain('R. Vance over 68.5 rec yds');
    expect(container.textContent).toContain('47 rec yds · 21.5 to go');
    expect(flash()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(DEMO_HIT_AT_MS - DEMO_PRE_GAME_MS);
    });
    expect(flash()).not.toBeNull();
    expect(container.textContent).toContain('PICK HIT · 70 REC YDS');
    expect(container.textContent).toContain('Hit · 70 rec yds');

    await act(async () => {
      vi.advanceTimersByTime(PICK_FLASH_MS);
    });
    expect(flash()).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(DEMO_TOTAL_MS);
    });
    expect(flash()).toBeNull();
  });

  it('shows the persistent DEMO banner, and Exit returns to real Home', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    expect(container.textContent).toContain('DEMO');

    const exitButton = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'Exit',
    );
    expect(exitButton).toBeDefined();
    await act(async () => {
      exitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(router.dismissTo).toHaveBeenCalledWith('/(app)');
  });
});
