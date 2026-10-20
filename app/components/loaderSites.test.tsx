// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IndexScreen from '../app/index';
import { SwitchingProvider, useSwitching } from '../contexts/SwitchingContext';
import { PlayerPicker } from './PlayerPicker';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-router', () => ({
  Redirect: () => null,
}));
vi.mock('../contexts/SessionContext', () => ({
  useSession: () => ({ isLoading: true, session: null }),
}));
vi.mock('../lib/players', () => ({
  searchPlayers: () => new Promise(() => undefined),
}));
vi.mock('../contexts/GameLinksContext', () => ({
  useGameLinks: () => ({ get: () => null }),
}));
vi.mock('../lib/apiClient', () => ({
  apiClient: {
    put: () => Promise.resolve(),
    get: () => new Promise(() => undefined),
  },
}));
vi.mock('../lib/fonts', () => ({
  fonts: {
    monoBold: 'monospace',
    monoMedium: 'monospace',
    sansSemiBold: 'sans-serif',
  },
}));

describe('replaced loader sites', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('renders the yard-line loader on the session gate', () => {
    act(() => {
      root.render(<IndexScreen />);
    });
    expect(host.querySelector('[data-testid="yard-line-loader"]')).toBeTruthy();
  });

  it('renders the yard-line loader while player search is in flight', () => {
    act(() => {
      root.render(
        <PlayerPicker
          errorMessage={null}
          isSaving={false}
          onAdd={() => undefined}
          onRemove={() => undefined}
          onSave={() => undefined}
          roster={[]}
        />,
      );
    });
    const input = host.querySelector('input');
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Mahomes');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="yard-line-loader"]')).toBeTruthy();
  });

  it('renders the yard-line loader on the switching overlay', () => {
    globalThis.open = () => null;
    function Go() {
      const { switchToGame } = useSwitching();
      return (
        <button
          onClick={() =>
            switchToGame({
              gameId: 'g1',
              deepLinkUrl: 'https://example.com/watch',
              label: 'Chiefs',
            })
          }
          type="button"
        >
          Switch
        </button>
      );
    }
    act(() => {
      root.render(
        <SwitchingProvider>
          <Go />
        </SwitchingProvider>,
      );
    });
    act(() => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="yard-line-loader"]')).toBeTruthy();
  });
});
