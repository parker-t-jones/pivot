// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Linking } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DemoGameDayScreen from '../app/(app)/demo-game-day';
import { PICK_FLASH_MS } from '../components/PickEventFlash';
import {
  DEMO_ACTIVE_AT_MS,
  DEMO_ALERT_VISIBLE_MS,
  DEMO_ALERTS,
  DEMO_CLOSING_AT_MS,
  DEMO_COUNTDOWN_TICK_MS,
  DEMO_HIT_AT_MS,
  DEMO_PRE_GAME_MS,
  DEMO_TOTAL_MS,
  DEMO_WATCH_HINT,
  DEMO_WATCH_LABEL,
} from '../lib/demoGameDay';

const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    listeners,
    emit: (state: string) => {
      for (const listener of listeners) listener(state);
    },
  };
});

vi.mock('react-native', async () => {
  const rn = await import('react-native-web');
  return {
    ...rn,
    AppState: {
      currentState: 'active',
      addEventListener: (_type: string, listener: (state: string) => void) => {
        appState.listeners.add(listener);
        return { remove: () => appState.listeners.delete(listener) };
      },
    },
  };
});

// The real live game card reads font names from `lib/fonts`, which loads expo-font (needs `__DEV__`).
vi.mock('../lib/fonts', () => ({
  fonts: {
    teamNickname: 'sans-serif',
    sansBold: 'sans-serif',
    sansSemiBold: 'sans-serif',
    monoBold: 'monospace',
    monoSemiBold: 'monospace',
    monoMedium: 'monospace',
  },
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

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

const notifications = vi.hoisted(() => ({
  schedule: vi.fn(async (_startedAt: number): Promise<string[]> => []),
  cancel: vi.fn(async (_ids: readonly string[]): Promise<void> => undefined),
}));
vi.mock('../lib/demoGameDayNotification', () => ({
  scheduleDemoGameDayNotificationsAsync: notifications.schedule,
  cancelDemoGameDayNotificationsAsync: notifications.cancel,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion.value = false;
  appState.listeners.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  router.dismissTo.mockClear();
  router.replace.mockClear();
  notifications.schedule.mockReset();
  notifications.schedule.mockResolvedValue([]);
  notifications.cancel.mockReset();
  notifications.cancel.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const STEP_MS = 200;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const bannerTitle = () => byId('demo-alert-title')?.textContent ?? null;

async function mount() {
  await act(async () => {
    root.render(<DemoGameDayScreen />);
  });
}

/** Advances in screen-sized steps so each tick's effects flush, as they do on a device. */
async function advance(ms: number, onStep?: (elapsedSinceCall: number) => void) {
  for (let spent = 0; spent < ms; spent += STEP_MS) {
    await act(async () => {
      vi.advanceTimersByTime(Math.min(STEP_MS, ms - spent));
    });
    onStep?.(spent + STEP_MS);
  }
}

/** Plays the whole demo from the start; returns each banner title with the demo time it appeared. */
async function playAndRecordBanners(): Promise<{ title: string; at: number }[]> {
  const seen: { title: string; at: number }[] = [];
  let last: string | null = null;
  let at = 0;
  const record = () => {
    const title = bannerTitle();
    if (title !== null && title !== last) seen.push({ title, at });
    last = title;
  };
  record();
  await advance(DEMO_TOTAL_MS + STEP_MS, (spent) => {
    at = spent;
    record();
  });
  return seen;
}

describe('DemoGameDayScreen: countdown', () => {
  it('starts at 10 and steps down a number every 600ms, about 6s in all', async () => {
    await mount();
    expect(byId('demo-countdown-card')).not.toBeNull();
    expect(byId('demo-countdown')?.textContent).toBe('0:10');
    expect(container.textContent).toContain('Pivot is watching for your picks');
    expect(container.textContent).toContain('CMT');
    expect(container.textContent).toContain('HBR');
    expect(byId('demo-home-live')).toBeNull();

    await advance(DEMO_COUNTDOWN_TICK_MS);
    expect(byId('demo-countdown')?.textContent).toBe('0:09');
    await advance(DEMO_COUNTDOWN_TICK_MS * 4);
    expect(byId('demo-countdown')?.textContent).toBe('0:05');
    await advance(DEMO_COUNTDOWN_TICK_MS * 4);
    expect(byId('demo-countdown')?.textContent).toBe('0:01');
    expect(byId('demo-countdown-card')).not.toBeNull();

    await advance(DEMO_COUNTDOWN_TICK_MS);
    expect(byId('demo-countdown-card')).toBeNull();
    expect(DEMO_PRE_GAME_MS).toBe(6_000);
  });

  it('shows no alert during the countdown', async () => {
    await mount();
    await advance(DEMO_PRE_GAME_MS - STEP_MS);
    expect(bannerTitle()).toBeNull();
  });
});

describe('DemoGameDayScreen: Home live view', () => {
  it('goes live as Home on a game day: NOW ACTIVE hero with the gauge, then YOUR PICKS', async () => {
    await mount();
    await advance(DEMO_PRE_GAME_MS);
    expect(byId('demo-countdown-card')).toBeNull();
    expect(byId('demo-watchlist')).toBeNull();
    expect(byId('demo-live-row')).toBeNull();
    const home = byId('demo-home-live');
    expect(home).not.toBeNull();
    expect(byId('demo-home-live-eyebrow')?.textContent).toBe('● LIVE · 1 GAME');
    const hero = byId('demo-home-live-hero');
    expect(hero?.textContent).toContain('NOW ACTIVE');
    expect(byId('live-score-left')?.textContent).toBe('COMETS10');
    expect(byId('live-score-right')?.textContent).toBe('7HARBOR');
    expect(hero?.textContent).toContain('CMT 25');
    expect(hero?.textContent).toContain('Q3 · 7:40 · 1st & 10');
    expect(hero?.textContent).toContain('R. Vance WR · ON FIELD');
    const section = byId('demo-home-live-picks');
    expect(section?.textContent).toContain('YOUR PICKS · 2');
    expect(section?.querySelectorAll('[data-testid="pick-card-live"]')).toHaveLength(2);
    expect(container.textContent).toContain('R. Vance over 68.5 rec yds');
    expect(container.textContent).toContain('47 rec yds · 21.5 to go');
    expect(byId('pick-card-bar-fill-hit')).toBeNull();
  });

  it('moves the hero gauge, clock and score with the three beats', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS);
    expect(byId('demo-home-live-hero')?.textContent).toContain('CMT 25');

    await advance(DEMO_CLOSING_AT_MS - DEMO_ACTIVE_AT_MS);
    expect(byId('demo-home-live-hero')?.textContent).toContain('HBR 34');
    expect(byId('demo-home-live-hero')?.textContent).toContain('Q3 · 5:55 · 2nd & 7');
    expect(byId('live-score-left')?.textContent).toBe('COMETS10');

    await advance(DEMO_HIT_AT_MS - DEMO_CLOSING_AT_MS);
    expect(byId('demo-home-live-hero')?.textContent).toContain('HBR 2');
    expect(byId('demo-home-live-hero')?.textContent).toContain('RED ZONE');
    expect(byId('live-score-left')?.textContent).toBe('COMETS17');
  });

  it('opens nothing from the Watch button: only the demo hint, no link and no network call', async () => {
    const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const canOpenURL = vi.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await mount();
    await advance(DEMO_PRE_GAME_MS);
    const button = Array.from(container.querySelectorAll('[role="button"]')).find((el) =>
      (el.textContent ?? '').includes(DEMO_WATCH_LABEL),
    );
    expect(button).toBeDefined();
    expect(byId('demo-watch-hint')).toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(byId('demo-watch-hint')?.textContent).toBe(DEMO_WATCH_HINT);
    expect(openURL).not.toHaveBeenCalled();
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('steps the card up with each alert: 47, then 62, then the hit with the green bar and glow', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS);
    expect(container.textContent).toContain('47 rec yds');

    await advance(DEMO_CLOSING_AT_MS - DEMO_ACTIVE_AT_MS);
    expect(container.textContent).toContain('62 rec yds · 6.5 to go');
    expect(container.textContent).not.toContain('47 rec yds');
    expect(byId('pick-card-bar-fill-hit')).toBeNull();

    await advance(DEMO_HIT_AT_MS - DEMO_CLOSING_AT_MS);
    expect(container.textContent).toContain('Hit · 70 rec yds');
    expect(byId('pick-card-bar-fill-hit')).not.toBeNull();
  });

  it('keeps the persistent DEMO banner and Exit for the whole demo', async () => {
    await mount();
    for (const step of [DEMO_PRE_GAME_MS, DEMO_HIT_AT_MS - DEMO_PRE_GAME_MS, DEMO_TOTAL_MS]) {
      expect(container.textContent).toContain('DEMO — not a real game');
      expect(container.textContent).toContain('Exit');
      await advance(step);
    }
    expect(container.textContent).toContain('Demo complete');
    expect(container.textContent).toContain('DEMO — not a real game');
  });
});

describe('DemoGameDayScreen: three alerts, in-app path (web, foreground, no OS delivery)', () => {
  it('shows each of the three alerts exactly once, in order, with the demo copy', async () => {
    await mount();
    const seen = await playAndRecordBanners();
    expect(seen.map((entry) => entry.title)).toEqual(DEMO_ALERTS.map((alert) => alert.title));
  });

  it('shows each alert at its own time, 8s apart', async () => {
    await mount();
    const seen = await playAndRecordBanners();
    expect(seen).toHaveLength(3);
    seen.forEach((entry, i) => {
      const alert = DEMO_ALERTS[i];
      expect(entry.at).toBeGreaterThanOrEqual(alert?.atMs ?? Infinity);
      expect(entry.at - (alert?.atMs ?? 0)).toBeLessThanOrEqual(STEP_MS);
    });
    const gaps = seen.slice(1).map((entry, i) => entry.at - (seen[i]?.at ?? 0));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(6_000);
      expect(gap).toBeLessThanOrEqual(12_000);
    }
  });

  it('active: a nudge that reveals nothing, while the card is live at 47', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS - STEP_MS);
    expect(bannerTitle()).toBeNull();
    await advance(STEP_MS);
    expect(byId('demo-alert-active')).not.toBeNull();
    expect(byId('demo-alert-body')?.textContent).toBe('R. Vance is on the field for your pick.');
    expect(container.textContent).toContain('47 rec yds');
    expect(byId('pick-event-flash')).toBeNull();
  });

  it('closing in: the message numbers match the card at the same moment', async () => {
    await mount();
    await advance(DEMO_CLOSING_AT_MS - STEP_MS);
    expect(byId('demo-alert-closing')).toBeNull();
    expect(container.textContent).toContain('47 rec yds');
    await advance(STEP_MS);
    expect(byId('demo-alert-closing')).not.toBeNull();
    expect(byId('demo-alert-body')?.textContent).toBe('R. Vance is at 62 of 68.5 receiving yards.');
    expect(container.textContent).toContain('62 rec yds · 6.5 to go');
  });

  it('hit: the alert, the edge pulse and lower-third, and the green bar land together', async () => {
    await mount();
    await advance(DEMO_HIT_AT_MS - STEP_MS);
    expect(byId('demo-alert-hit')).toBeNull();
    expect(byId('pick-event-flash')).toBeNull();
    expect(byId('pick-card-bar-fill-hit')).toBeNull();
    await advance(STEP_MS);
    expect(byId('demo-alert-hit')).not.toBeNull();
    expect(byId('demo-alert-body')?.textContent).toBe('R. Vance cleared 68.5 with 70 yards.');
    expect(byId('pick-event-flash')).not.toBeNull();
    expect(container.textContent).toContain('PICK HIT · 70 REC YDS');
    expect(byId('pick-card-bar-fill-hit')).not.toBeNull();
  });

  it('hides each banner before the next one arrives, so two never stack', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS + DEMO_ALERT_VISIBLE_MS + STEP_MS);
    expect(bannerTitle()).toBeNull();
    await advance(DEMO_CLOSING_AT_MS - DEMO_ACTIVE_AT_MS - DEMO_ALERT_VISIBLE_MS);
    expect(byId('demo-alert-closing')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="demo-alert-title"]')).toHaveLength(1);
  });

  it('lets the person dismiss one early, and it does not come back', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS);
    expect(byId('demo-alert-active')).not.toBeNull();
    const dismiss = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => el.textContent === 'Dismiss',
    );
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(bannerTitle()).toBeNull();
    await advance(STEP_MS * 5);
    expect(bannerTitle()).toBeNull();
  });

  it('plays the hit flash once, keeps the glow after it, then completes', async () => {
    await mount();
    await advance(DEMO_HIT_AT_MS);
    expect(byId('pick-event-flash')).not.toBeNull();
    await advance(PICK_FLASH_MS);
    expect(byId('pick-event-flash')).toBeNull();
    expect(byId('pick-card-bar-fill-hit')).not.toBeNull();
    await advance(DEMO_TOTAL_MS);
    expect(byId('pick-event-flash')).toBeNull();
    expect(container.textContent).toContain('Demo complete');
    expect(bannerTitle()).toBeNull();
  });
});

describe('DemoGameDayScreen: iOS foreground (OS notifications scheduled, app active)', () => {
  it('still shows the three in-app banners once each; the OS banner is suppressed in the foreground', async () => {
    notifications.schedule.mockResolvedValue(['a', 'b', 'c']);
    await mount();
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
    const seen = await playAndRecordBanners();
    expect(seen.map((entry) => entry.title)).toEqual(DEMO_ALERTS.map((alert) => alert.title));
  });

  it('schedules the OS notifications once, up front, from the demo start', async () => {
    await mount();
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
    expect(typeof notifications.schedule.mock.calls[0]?.[0]).toBe('number');
    await advance(DEMO_TOTAL_MS + STEP_MS);
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending OS notifications when the person exits mid-demo', async () => {
    notifications.schedule.mockResolvedValue(['a', 'b', 'c']);
    await mount();
    await advance(DEMO_ACTIVE_AT_MS + STEP_MS);
    act(() => {
      root.unmount();
    });
    expect(notifications.cancel).toHaveBeenCalledWith(['a', 'b', 'c']);
    root = createRoot(container);
  });
});

describe('DemoGameDayScreen: iOS backgrounded (OS delivers while timers are suspended)', () => {
  it('does not show a banner again for an alert the OS delivered while backgrounded', async () => {
    notifications.schedule.mockResolvedValue(['a', 'b', 'c']);
    await mount();
    let last: string | null = null;
    const seen: string[] = [];
    const record = () => {
      const title = bannerTitle();
      if (title !== null && title !== last) seen.push(title);
      last = title;
    };
    await advance(DEMO_ACTIVE_AT_MS + 2_000, record);
    expect(seen).toEqual([DEMO_ALERTS[0]?.title]);

    // Backgrounded through the closing-in and hit alerts, back after the hit.
    act(() => appState.emit('background'));
    await advance(DEMO_HIT_AT_MS + 2_000 - (DEMO_ACTIVE_AT_MS + 2_000), record);
    act(() => appState.emit('active'));
    await advance(DEMO_TOTAL_MS, record);

    expect(seen).toEqual([DEMO_ALERTS[0]?.title]);
    expect(bannerTitle()).toBeNull();
  });

  it('shows the card in its current state on return, not stale', async () => {
    notifications.schedule.mockResolvedValue(['a', 'b', 'c']);
    await mount();
    await advance(DEMO_ACTIVE_AT_MS + 2_000);
    act(() => appState.emit('background'));
    await advance(DEMO_HIT_AT_MS - DEMO_ACTIVE_AT_MS);
    act(() => appState.emit('active'));
    await advance(STEP_MS);
    expect(container.textContent).toContain('Hit · 70 rec yds');
  });

  it('still shows an alert that was due after the person came back', async () => {
    notifications.schedule.mockResolvedValue(['a', 'b', 'c']);
    await mount();
    await advance(DEMO_ACTIVE_AT_MS + 1_000);
    act(() => appState.emit('background'));
    await advance(2_000);
    act(() => appState.emit('active'));
    await advance(DEMO_CLOSING_AT_MS - (DEMO_ACTIVE_AT_MS + 3_000));
    expect(byId('demo-alert-closing')).not.toBeNull();
  });
});

describe('DemoGameDayScreen: no OS delivery (permission off, or web)', () => {
  it('plays fully on in-app banners when notification permission is off, with no error', async () => {
    notifications.schedule.mockRejectedValue(new Error('Notifications are turned off.'));
    await mount();
    const seen = await playAndRecordBanners();
    expect(seen.map((entry) => entry.title)).toEqual(DEMO_ALERTS.map((alert) => alert.title));
    expect(container.textContent).toContain('Demo complete');
    expect(container.textContent).not.toMatch(/error|couldn.?t|failed/i);
  });

  it('plays fully when scheduling throws something unexpected', async () => {
    notifications.schedule.mockRejectedValue(new Error('native module missing'));
    await mount();
    const seen = await playAndRecordBanners();
    expect(seen).toHaveLength(3);
    expect(container.textContent).toContain('Demo complete');
  });

  it('pauses the demo while the app is hidden, so no alert is missed on return', async () => {
    await mount();
    await advance(DEMO_ACTIVE_AT_MS - 1_000);
    act(() => appState.emit('background'));
    await advance(DEMO_TOTAL_MS);
    expect(bannerTitle()).toBeNull();
    expect(byId('demo-countdown-card')).not.toBeNull();
    act(() => appState.emit('active'));
    await advance(1_000 + STEP_MS);
    expect(byId('demo-alert-active')).not.toBeNull();
  });
});

describe('DemoGameDayScreen: local-only', () => {
  it('makes no network calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await mount();
    await advance(DEMO_TOTAL_MS + STEP_MS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the whole demo free of real teams, players, services and betting talk', async () => {
    await mount();
    const seen: string[] = [container.textContent ?? ''];
    await advance(DEMO_TOTAL_MS + STEP_MS, () => {
      seen.push(container.textContent ?? '');
    });
    const text = seen.join(' ');
    expect(text).not.toMatch(/\b(SEA|DAL)\b/);
    expect(text).not.toMatch(/metcalf/i);
    // The one Watch button is the demo's own label; no real service is ever named.
    expect(text.split(DEMO_WATCH_LABEL).join('')).not.toMatch(/watch on/i);
    expect(text).not.toMatch(/youtube|hulu|fubo|sling|directv|espn|peacock|sunday ticket/i);
    expect(text).not.toMatch(/stake/i);
    expect(text).not.toMatch(/\b(odds|bet|bets|wager|edge)\b/i);
    expect(text).toContain('DEMO');
    expect(text).toContain('pick');
  });

  it('shows the persistent DEMO banner, and Exit returns to real Home', async () => {
    await mount();
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

describe('DemoGameDayScreen: Reduce Motion', () => {
  it('still plays all three alerts and the hit moment', async () => {
    reduceMotion.value = true;
    await mount();
    const seen = await playAndRecordBanners();
    expect(seen.map((entry) => entry.title)).toEqual(DEMO_ALERTS.map((alert) => alert.title));
  });

  it('keeps the hit flash and the resting hit state', async () => {
    reduceMotion.value = true;
    await mount();
    await advance(DEMO_HIT_AT_MS);
    expect(byId('pick-event-flash')).not.toBeNull();
    await advance(PICK_FLASH_MS);
    expect(byId('pick-card-bar-fill-hit')).not.toBeNull();
  });
});
