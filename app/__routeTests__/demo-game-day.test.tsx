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

const reduceMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/useReducedMotion', () => ({
  useReducedMotion: () => reduceMotion.value,
}));

const scheduleDemoNotification = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/demoGameDayNotification', () => ({
  scheduleDemoGameDayNotificationAsync: scheduleDemoNotification,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion.value = false;
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

const byId = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`);

describe('DemoGameDayScreen', () => {
  it('pre-game: the countdown card counts down with the one-line promise and both team badges', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    expect(byId(container, 'demo-countdown-card')).not.toBeNull();
    expect(byId(container, 'demo-countdown')?.textContent).toBe('0:15');
    expect(container.textContent).toContain('Pivot is watching for your picks');
    expect(container.textContent).toContain('CMT');
    expect(container.textContent).toContain('HBR');
    expect(byId(container, 'demo-live-row')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(byId(container, 'demo-countdown')?.textContent).toBe('0:10');

    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS - 5_000 - 500);
    });
    expect(byId(container, 'demo-countdown')?.textContent).toBe('0:01');
  });

  it('live: the row shows the dot, ticker, both score lines, the possession line and the pick cards', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS + 500);
    });
    expect(byId(container, 'demo-countdown-card')).toBeNull();
    const row = byId(container, 'demo-live-row');
    expect(row).not.toBeNull();
    expect(byId(container, 'demo-live-row-glowing')).toBeNull();
    expect(byId(container, 'demo-live-dot')).not.toBeNull();
    expect(byId(container, 'demo-live-ticker')?.textContent).toBe('LIVE · Q3 · 7:40');
    expect(byId(container, 'demo-score-HBR')?.textContent).toContain('7');
    expect(byId(container, 'demo-score-CMT')?.textContent).toContain('10');
    expect(byId(container, 'demo-pylon-marker')).not.toBeNull();
    expect(byId(container, 'demo-possession-line')?.textContent).toBe(
      'CMT ball · 1st & 10 · CMT 25',
    );
    // The pick cards render inside the row, not beside it.
    expect(row?.querySelectorAll('[data-testid="pick-card-live"]')).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(byId(container, 'demo-live-ticker')?.textContent).toBe('LIVE · Q3 · 5:55');
    expect(byId(container, 'demo-possession-line')?.textContent).toBe(
      'CMT ball · 2nd & 7 · HBR 34',
    );
  });

  it('hit: the live row takes the glow with the card hit state, and keeps it after the flash fades', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_HIT_AT_MS + 500);
    });
    expect(byId(container, 'demo-live-row')).toBeNull();
    expect(byId(container, 'demo-live-row-glowing')).not.toBeNull();
    expect(byId(container, 'pick-card-bar-fill-hit')).not.toBeNull();
    expect(byId(container, 'demo-score-CMT')?.textContent).toContain('17');
    expect(byId(container, 'demo-live-ticker')?.textContent).toBe('LIVE · Q3 · 4:12');
    expect(byId(container, 'pick-event-flash')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(PICK_FLASH_MS);
    });
    expect(byId(container, 'pick-event-flash')).toBeNull();
    expect(byId(container, 'demo-live-row-glowing')).not.toBeNull();
    expect(byId(container, 'pick-card-bar-fill-hit')).not.toBeNull();
  });

  it('keeps the whole demo free of real teams, players, watch buttons and the old copy', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    const seen = [container.textContent ?? ''];
    for (const step of [DEMO_PRE_GAME_MS + 500, DEMO_HIT_AT_MS - DEMO_PRE_GAME_MS]) {
      await act(async () => {
        vi.advanceTimersByTime(step);
      });
      seen.push(container.textContent ?? '');
    }
    const text = seen.join(' ');
    expect(text).not.toMatch(/\b(SEA|DAL)\b/);
    expect(text).not.toMatch(/metcalf/i);
    expect(text).not.toMatch(/watch on/i);
    expect(text).not.toMatch(/stake/i);
    expect(text).toContain('DEMO');
  });

  it('Reduce Motion: no pulsing ring on the LIVE dot, and the hit moment still plays', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS + 500);
    });
    expect(byId(container, 'demo-live-dot-ring')).not.toBeNull();
    act(() => {
      root.unmount();
    });
    reduceMotion.value = true;
    root = createRoot(container);
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_PRE_GAME_MS + 500);
    });
    expect(byId(container, 'demo-live-dot')).not.toBeNull();
    expect(byId(container, 'demo-live-dot-ring')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(DEMO_HIT_AT_MS - DEMO_PRE_GAME_MS);
    });
    expect(byId(container, 'pick-event-flash')).not.toBeNull();
    expect(byId(container, 'demo-live-row-glowing')).not.toBeNull();
  });

  it('starts pre-game, flips to live with one scheduled notification, then completes', async () => {
    await act(async () => {
      root.render(<DemoGameDayScreen />);
    });
    expect(container.textContent).toContain('DEMO · KICKOFF IN');
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
