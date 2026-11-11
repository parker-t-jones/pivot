// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationBannerHost } from './NotificationBannerHost';
import { flagEventPayload } from '../fixtures/flagEvent.testFixture';
import { DEMO_ALERTS } from '../lib/demoGameDay';

const notifications = vi.hoisted(() => ({
  listener: undefined as ((notification: unknown) => void) | undefined,
  remove: vi.fn(),
}));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  addNotificationReceivedListener: (listener: (notification: unknown) => void) => {
    notifications.listener = listener;
    return { remove: notifications.remove };
  },
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ dismissTo: vi.fn() }) }));
vi.mock('react-native', async () => {
  const web = await import('react-native-web');
  return { ...web, Platform: { ...web.Platform, OS: 'ios' } };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  initialWindowMetrics: null,
}));
vi.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../contexts/SwitchingContext', () => ({
  useSwitching: () => ({ switchToGame: vi.fn() }),
}));
vi.mock('../lib/notificationActions', () => ({ recordNotificationAction: vi.fn() }));
vi.mock('./FlagEventBanner', () => ({
  FlagEventBanner: ({ banner }: { banner: { title: string; body: string } }) => (
    <div role="alert">
      {banner.title}: {banner.body}
    </div>
  ),
}));

let container: HTMLDivElement;
let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  notifications.listener = undefined;
  notifications.remove.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NotificationBannerHost />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  warn.mockRestore();
});

function receive(data: unknown) {
  expect(notifications.listener).toBeTypeOf('function');
  act(() => {
    notifications.listener?.({
      request: { content: { title: 'Pick alert', body: 'Your pick is active.', data } },
    });
  });
}

describe('NotificationBannerHost foreground listener', () => {
  it.each(DEMO_ALERTS)('silently ignores the $kind demo notification', ({ kind }) => {
    receive({ demo: true, kind });
    expect(warn).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([{}, { demo: true, kind: 'unknown' }, { demo: 'true', kind: 'active' }])(
    'keeps warning for unrecognized data: %j',
    (data) => {
      receive(data);
      expect(warn).toHaveBeenCalledWith(
        '[banner] received notification with unrecognized data shape — ignoring',
        data,
      );
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it('still renders real flag events, including one after a demo notification', () => {
    receive({ demo: true, kind: 'active' });
    receive(flagEventPayload);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Pick alert: Your pick is active.',
    );
    expect(warn).not.toHaveBeenCalled();
    receive({ demo: true, kind: 'hit' });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
