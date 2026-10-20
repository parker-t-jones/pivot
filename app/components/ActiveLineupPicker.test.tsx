// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeagueSummary } from '../lib/leagues';
import type { MeResponse } from '../lib/me';
import { ActiveLineupPicker } from './ActiveLineupPicker';

const patchPreferences = vi.fn();
const tier = vi.hoisted(() => ({ value: 'companion' }));

vi.mock('react-native', () => import('react-native-web'));
vi.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
}));
vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade: () => undefined }),
}));
vi.mock('../lib/useDesktopTier', () => ({
  useDesktopTier: () => tier.value,
}));
vi.mock('../lib/me', () => ({
  fetchMe: vi.fn(),
  patchPreferences: (...args: unknown[]) => patchPreferences(...args),
}));
vi.mock('../lib/fonts', () => ({
  fonts: {
    monoBold: 'monospace',
    sansSemiBold: 'sans-serif',
  },
}));

const leagues: LeagueSummary[] = [
  {
    league_id: 'lg-sleeper',
    platform: 'sleeper',
    name: 'Test League',
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
  },
  {
    league_id: 'lg-manual',
    platform: 'manual',
    name: 'Office',
    sport: 'nfl',
    season_year: 2026,
    last_synced_at: null,
  },
];

function me(watchedLeagueIds: string[]): MeResponse {
  return {
    user_id: 'user-1',
    email: 'test@fantasyfocus.dev',
    subscription_tier: 'free',
    preferences: {
      notificationMode: 'all',
      quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
      autoSwitch: false,
      watchOpponent: false,
      watchedLeagueIds,
    },
    app_presence: [],
  };
}

describe('ActiveLineupPicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    tier.value = 'companion';
    patchPreferences.mockReset();
    patchPreferences.mockResolvedValue(me(['lg-manual']));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('labels the control and shows the league name with the platform', () => {
    act(() => {
      root.render(
        <ActiveLineupPicker leagues={leagues} me={me(['lg-sleeper'])} onMeUpdated={() => undefined} />,
      );
    });
    expect(host.textContent).toContain('Active lineup');
    expect(host.textContent).toContain('Test League');
    expect(host.textContent).toContain('Sleeper');
    expect(host.querySelector('[data-testid="active-lineup-trigger"]')?.getAttribute('aria-label')).toBe(
      'Active lineup',
    );
  });

  it('still saves the tapped league as the only watched lineup', () => {
    const onMeUpdated = vi.fn();
    act(() => {
      root.render(
        <ActiveLineupPicker leagues={leagues} me={me(['lg-sleeper'])} onMeUpdated={onMeUpdated} />,
      );
    });
    const trigger = host.querySelector<HTMLElement>('[data-testid="active-lineup-trigger"]');
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('Office');
    expect(document.querySelector('[data-testid="active-lineup-sheet"]')).toBeTruthy();
    const office = Array.from(document.querySelectorAll('[data-testid="active-lineup-option"]')).find(
      (node) => node.textContent?.includes('Office'),
    );
    act(() => {
      (office as HTMLElement | undefined)?.click();
    });
    expect(patchPreferences).toHaveBeenCalledWith({ watchedLeagueIds: ['lg-manual'] });
  });

  it('opens a desktop menu and closes it from the keyboard', () => {
    tier.value = 'wide';
    act(() => {
      root.render(
        <ActiveLineupPicker leagues={leagues} me={me(['lg-sleeper'])} onMeUpdated={() => undefined} />,
      );
    });
    act(() => {
      host.querySelector<HTMLElement>('[data-testid="active-lineup-trigger"]')?.click();
    });
    expect(document.querySelector('[data-testid="active-lineup-dropdown"]')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="active-lineup-dropdown"]')).toBeNull();
  });
});
