// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectTeamScreen from '../app/(app)/connect-team';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(() => false),
}));
const searchParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('expo-router', () => ({
  useRouter: () => router,
  useLocalSearchParams: () => searchParams.value,
}));

const leaguesGate = vi.hoisted(() => ({
  deferConnect: vi.fn(),
  refreshLeagues: vi.fn(async () => []),
}));
vi.mock('../contexts/LeaguesGateContext', () => ({
  useLeaguesGate: () => leaguesGate,
}));
vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade: vi.fn() }),
}));
vi.mock('../lib/apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../lib/leagues', () => ({
  connectManualLeague: vi.fn(),
  connectSleeperLeague: vi.fn(),
  fetchLineup: vi.fn(),
  fetchSleeperLeagues: vi.fn(),
  putManualLineup: vi.fn(),
}));
vi.mock('../lib/navigateAfterConnect', () => ({
  navigateAfterConnect: vi.fn(),
}));
vi.mock('../lib/upgradePrompt', () => ({
  promptUpgradeForCapError: vi.fn(() => false),
}));

const me = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  patchPreferences: vi.fn(async (patch: unknown) => patch),
}));
vi.mock('../lib/me', () => ({
  fetchMe: me.fetchMe,
  patchPreferences: me.patchPreferences,
  FREE_MAX_MANUAL_LINEUP_SLOTS: 9,
}));

function baseMe(following: string[] = []) {
  return {
    user_id: 'u1',
    email: 'a@b.com',
    subscription_tier: 'free' as const,
    preferences: {
      notificationMode: 'all' as const,
      quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
      autoSwitch: false,
      watchOpponent: false,
      watchedLeagueIds: [],
      following,
    },
    app_presence: [],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  searchParams.value = {};
  router.push.mockClear();
  router.replace.mockClear();
  leaguesGate.deferConnect.mockClear();
  leaguesGate.refreshLeagues.mockClear();
  me.fetchMe.mockReset();
  me.patchPreferences.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

async function render(params: Record<string, string>) {
  searchParams.value = params;
  await act(async () => {
    root.render(<ConnectTeamScreen />);
  });
}

describe('ConnectTeamScreen — "What are you following?" (#31 step 3)', () => {
  it('asks first during onboarding when following is unanswered, then orders Add your first picks', async () => {
    me.fetchMe.mockResolvedValue(baseMe([]));
    await render({ onboarding: '1' });

    expect(container.textContent).toContain('What are you following?');
    expect(container.textContent).not.toContain('Add your first picks');

    const betsChip = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'Bets & props',
    );
    expect(betsChip).toBeDefined();
    await act(async () => {
      betsChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const continueButton = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'Continue',
    );
    expect(continueButton).toBeDefined();
    await act(async () => {
      continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(me.patchPreferences).toHaveBeenCalledWith({ following: ['bets'] });
    expect(container.textContent).toContain('Add your first picks');
    // "bets" was chosen, so "Add a pick" is ordered ahead of Connect Sleeper / Add manually.
    const text = container.textContent ?? '';
    const pickIndex = text.indexOf('Add a pick');
    const sleeperIndex = text.indexOf('Connect Sleeper');
    const manualIndex = text.indexOf('Add manually');
    expect(pickIndex).toBeGreaterThan(-1);
    expect(pickIndex).toBeLessThan(sleeperIndex);
    expect(sleeperIndex).toBeLessThan(manualIndex);
  });

  it('skips the question when following was already answered', async () => {
    me.fetchMe.mockResolvedValue(baseMe(['fantasy']));
    await render({ onboarding: '1' });

    expect(container.textContent).not.toContain('What are you following?');
    expect(container.textContent).toContain('Add your first picks');
  });

  it('skips the question outside onboarding (Settings / Home State 5)', async () => {
    await render({});

    expect(me.fetchMe).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('What are you following?');
    expect(container.textContent).toContain('Add your first picks');
  });

  it('defaults to the plan order (Connect Sleeper, Add manually, Add a pick) with no selection', async () => {
    await render({});

    const text = container.textContent ?? '';
    const sleeperIndex = text.indexOf('Connect Sleeper');
    const manualIndex = text.indexOf('Add manually');
    const pickIndex = text.indexOf('Add a pick');
    expect(sleeperIndex).toBeLessThan(manualIndex);
    expect(manualIndex).toBeLessThan(pickIndex);
  });
});
