// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NotificationsPermissionScreen from '../app/(app)/notifications-permission';

vi.mock('react-native', () => import('react-native-web'));

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('../contexts/PushPermissionContext', () => ({
  usePushPermission: () => ({ requestAndRegister: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('NotificationsPermissionScreen — step 6 copy (#31)', () => {
  it('explains alert timing can arrive before the drive starts, not that it never precedes the stream', async () => {
    await act(async () => {
      root.render(<NotificationsPermissionScreen />);
    });

    expect(container.textContent).toContain('before the drive starts');
    expect(container.textContent).toContain('Alert timing in Settings');
    expect(container.textContent).not.toContain('never shows up in a notification before');
  });
});
