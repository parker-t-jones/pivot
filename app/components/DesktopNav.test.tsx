// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopNav } from './DesktopNav';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-router', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock('../lib/me', () => ({
  fetchMe: () => Promise.reject(new Error('offline')),
}));
vi.mock('../lib/fonts', () => ({
  fonts: {
    sansBold: 'sans-serif',
    sansSemiBold: 'sans-serif',
  },
}));

describe('DesktopNav settings icon', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('draws a gear for Settings', () => {
    act(() => {
      root.render(<DesktopNav lineupLabel="Watchlist" tier="wide" />);
    });
    const settings = Array.from(host.querySelectorAll('[role="link"]')).find((node) =>
      node.textContent?.includes('Settings'),
    );
    expect(settings?.querySelector('[data-testid="nav-settings-gear"]')).toBeTruthy();
  });
});
