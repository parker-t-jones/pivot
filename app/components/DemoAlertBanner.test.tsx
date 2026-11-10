// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoAlertBanner } from './DemoAlertBanner';
import { DEMO_ALERT_VISIBLE_MS, DEMO_ALERTS } from '../lib/demoGameDay';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

const reduceMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/useReducedMotion', () => ({
  useReducedMotion: () => reduceMotion.value,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion.value = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const [ACTIVE, CLOSING] = DEMO_ALERTS;
if (!ACTIVE || !CLOSING) throw new Error('expected demo alerts');

describe('DemoAlertBanner', () => {
  it('shows the alert title and body in an alert region', async () => {
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={() => undefined} />);
    });
    expect(byId('demo-alert-active')).not.toBeNull();
    expect(byId('demo-alert-active')?.getAttribute('role')).toBe('alert');
    expect(byId('demo-alert-title')?.textContent).toBe(ACTIVE.title);
    expect(byId('demo-alert-body')?.textContent).toBe(ACTIVE.body);
  });

  it('has Dismiss and nothing that switches games or opens a watch link', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={onDismiss} />);
    });
    expect(container.textContent).not.toMatch(/switch|watch/i);
    const dismiss = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => el.textContent === 'Dismiss',
    );
    expect(dismiss).toBeDefined();
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses itself after the visible time, once, and before the next alert is due', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={onDismiss} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_ALERT_VISIBLE_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(DEMO_ALERT_VISIBLE_MS * 3);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(DEMO_ALERT_VISIBLE_MS).toBeLessThan(CLOSING.atMs - ACTIVE.atMs);
  });

  it('re-arms the dismiss timer for a new alert key', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={onDismiss} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_ALERT_VISIBLE_MS - 1_000);
    });
    await act(async () => {
      root.render(<DemoAlertBanner alert={CLOSING} alertKey={2} onDismiss={onDismiss} />);
    });
    expect(byId('demo-alert-title')?.textContent).toBe(CLOSING.title);
    await act(async () => {
      vi.advanceTimersByTime(DEMO_ALERT_VISIBLE_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss after it unmounts', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={onDismiss} />);
    });
    act(() => {
      root.unmount();
    });
    await act(async () => {
      vi.advanceTimersByTime(DEMO_ALERT_VISIBLE_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('Reduce Motion: sits in place, with no slide-in', async () => {
    reduceMotion.value = true;
    await act(async () => {
      root.render(<DemoAlertBanner alert={ACTIVE} alertKey={1} onDismiss={() => undefined} />);
    });
    const card = byId('demo-alert-active') as HTMLElement | null;
    expect(card?.style.transform).toBe('translateY(0px)');
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(card?.style.transform).toBe('translateY(0px)');
    expect(byId('demo-alert-title')?.textContent).toBe(ACTIVE.title);
  });
});
