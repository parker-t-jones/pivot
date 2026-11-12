// @vitest-environment happy-dom
// Import from screenshot (#12): the rendered path from the type step to POST /picks.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../lib/apiClient';
import { AddPickFlow } from './AddPickFlow';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../lib/fonts', () => ({
  fonts: {
    monoBold: 'system',
    monoMedium: 'system',
    monoSemiBold: 'system',
    sansBold: 'system',
    sansSemiBold: 'system',
    teamNickname: 'system',
  },
}));
const openUpgrade = vi.fn();
vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade }),
}));
const picker = vi.hoisted(() => ({ pickSlipImage: vi.fn<() => Promise<string | null>>() }));
vi.mock('../lib/slipImage', () => picker);
vi.mock('../lib/confirm', () => ({
  confirmAsync: vi.fn(async () => true),
  alertAsync: vi.fn(async () => undefined),
}));

/** The flow's network boundary. Every request the flow makes goes through these two. */
const api = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<unknown>>(),
  post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
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
  apiClient: { get: api.get, post: api.post },
}));

const GAMES = [
  {
    game_id: 'g-sf-sea',
    status: 'scheduled',
    scheduled_start: '2026-11-15T21:25:00Z',
    home_team_id: 'sea-id',
    away_team_id: 'sf-id',
    home_team: 'SEA',
    away_team: 'SF',
    home_team_name: 'Seattle Seahawks',
    away_team_name: 'San Francisco 49ers',
    airings: [],
    broadcasts: [],
  },
  {
    game_id: 'g-buf-kc',
    status: 'in_progress',
    scheduled_start: '2026-11-15T18:00:00Z',
    home_team_id: 'kc-id',
    away_team_id: 'buf-id',
    home_team: 'KC',
    away_team: 'BUF',
    home_team_name: 'Kansas City Chiefs',
    away_team_name: 'Buffalo Bills',
    airings: [],
    broadcasts: [],
  },
];

const KITTLE = {
  player_id: 'p-kittle',
  first_name: 'George',
  last_name: 'Kittle',
  position: 'TE',
  team: { team_id: 'sf-id', abbreviation: 'SF', name: 'San Francisco 49ers' },
};
const SF_DEF = {
  player_id: 'p-sf-def',
  first_name: 'San Francisco',
  last_name: '49ers',
  position: 'DEF',
  team: { team_id: 'sf-id', abbreviation: 'SF', name: 'San Francisco 49ers' },
};

let picksPage = { week: 11, free_limit: 3, free_slots_used: 1, picks: [], slips: [] };
let tier = 'free';

let importEnabled = true;

function routeGet(path: string): Promise<unknown> {
  if (path === '/health') {
    return Promise.resolve({ ok: true, slipImport: importEnabled ? 'enabled' : 'disabled' });
  }
  if (path === '/state/nfl') return Promise.resolve({ season: '2026', week: 11 });
  if (path.startsWith('/games')) return Promise.resolve({ week: 11, games: GAMES });
  if (path === '/me') {
    return Promise.resolve({
      subscription_tier: tier,
      is_demo: false,
      preferences: { watchedLeagueIds: [] },
    });
  }
  if (path === '/leagues') return Promise.resolve({ leagues: [] });
  if (path.startsWith('/picks')) return Promise.resolve(picksPage);
  if (path.startsWith('/players/search')) return Promise.resolve({ players: [KITTLE, SF_DEF] });
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const GAME_ROW = {
  game_id: 'g-sf-sea',
  status: 'scheduled',
  scheduled_start: '2026-11-15T21:25:00Z',
  home_team_id: 'sea-id',
  away_team_id: 'sf-id',
  home_team: 'SEA',
  away_team: 'SF',
  home_team_name: 'Seattle Seahawks',
  away_team_name: 'San Francisco 49ers',
};
const KITTLE_LEG = {
  status: 'ready',
  text: 'George Kittle 60+ Receiving Yards',
  pick: {
    gameId: 'g-sf-sea',
    playerId: 'p-kittle',
    condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 59.5 },
  },
  game: GAME_ROW,
  player: {
    player_id: 'p-kittle',
    first_name: 'George',
    last_name: 'Kittle',
    position: 'TE',
    team: { abbreviation: 'SF' },
  },
};
const SF_ML_LEG = {
  status: 'ready',
  text: '49ers Moneyline',
  pick: { gameId: 'g-sf-sea', teamId: 'sf-id', condition: { type: 'MONEYLINE', side: 'TEAM' } },
  game: GAME_ROW,
  player: null,
};
const FLAGGED_LEG = {
  status: 'flagged',
  text: 'Correct score 24-17',
  reason: 'Pivot can’t track this kind of pick yet.',
};

describe('add a pick: import from screenshot', () => {
  let root: Root;
  let host: HTMLDivElement;
  const onDismiss = vi.fn();
  let importResponse: () => Promise<unknown>;

  async function render(): Promise<void> {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AddPickFlow onDismiss={onDismiss} />);
    });
    await flush();
  }

  beforeEach(async () => {
    picksPage = { week: 11, free_limit: 3, free_slots_used: 1, picks: [], slips: [] };
    tier = 'free';
    importEnabled = true;
    importResponse = async () => ({ kind: 'single', legs: [KITTLE_LEG], imports_left: 4 });
    api.get.mockImplementation(routeGet);
    api.post.mockImplementation(async (path: string) =>
      path === '/picks/import' ? await importResponse() : {},
    );
    picker.pickSlipImage.mockResolvedValue('SCREENSHOT_BASE64');
    await render();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  function pressable(text: string): HTMLElement {
    const nodes = Array.from(
      host.querySelectorAll<HTMLElement>('[tabindex="0"], [role="button"], [role="tab"]'),
    ).filter((node) => node.textContent?.includes(text));
    const node = nodes.at(-1);
    if (!node) throw new Error(`no control with "${text}" in: ${host.textContent?.slice(0, 600)}`);
    return node;
  }

  async function tap(text: string): Promise<void> {
    act(() => {
      pressable(text).click();
    });
    await flush();
  }

  async function type(testId: string, value: string): Promise<void> {
    const input = host.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (!input) throw new Error(`missing ${testId}`);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
  }

  function slipText(): string {
    return host.querySelector('[data-testid="add-pick-slip"]')?.textContent ?? '';
  }

  it('hides the import button when the server has no model key', async () => {
    expect(host.textContent).toContain('Import from screenshot');
    act(() => root.unmount());
    host.remove();
    importEnabled = false;
    await render();
    expect(host.textContent).toContain('Player prop');
    expect(host.textContent).not.toContain('Import from screenshot');
  });

  it('imports a single pick into the normal review and saves only on Add a pick', async () => {
    await tap('Import from screenshot');
    expect(api.post).toHaveBeenCalledWith('/picks/import', { image: 'SCREENSHOT_BASE64' });
    expect(api.post).not.toHaveBeenCalledWith('/picks', expect.anything());

    expect(host.textContent).toContain('Check the pick we read from your screenshot.');
    expect(host.textContent).toContain('Kittle needs 60 or more receiving yards');
    expect(slipText()).toContain('G. Kittle over 59.5 rec yds');
    expect(host.textContent).toContain('Uses 1 of your 2 free bets');

    // Back is the edit path: the line step, filled in.
    await tap('Back');
    expect(host.querySelector<HTMLInputElement>('[data-testid="add-pick-line-field"]')?.value).toBe(
      '59.5',
    );
    await type('add-pick-line-field', '64.5');
    await tap('Continue');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      pick: {
        gameId: 'g-sf-sea',
        playerId: 'p-kittle',
        condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 64.5 },
      },
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does nothing when the user cancels the picker', async () => {
    picker.pickSlipImage.mockResolvedValueOnce(null);
    await tap('Import from screenshot');
    expect(api.post).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Player prop');
  });

  const sixLegs = () =>
    Array.from({ length: 6 }, (_, index) => ({
      ...KITTLE_LEG,
      pick: { ...KITTLE_LEG.pick, condition: { ...KITTLE_LEG.pick.condition, line: 50.5 + index } },
    }));

  function choices(): HTMLElement[] {
    return Array.from(
      host.querySelectorAll<HTMLElement>('[aria-label^="Select "], [aria-label^="Deselect "]'),
    );
  }

  async function choose(index: number): Promise<void> {
    act(() => choices()[index]?.click());
    await flush();
  }

  it('keeps six ready legs, limits selection to two, and frees a slot on deselect', async () => {
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    expect(openUpgrade).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      'You have 2 free picks left this week. Choose up to 2 of these 6 legs.',
    );
    expect(pressable('Continue').getAttribute('aria-disabled')).toBe('true');
    await choose(0);
    await choose(1);
    expect(choices()[2]?.getAttribute('aria-disabled')).toBe('true');
    await choose(2);
    expect(
      choices().filter((node) => node.getAttribute('aria-label')?.startsWith('Deselect ')),
    ).toHaveLength(2);
    await choose(0);
    expect(choices()[2]?.getAttribute('aria-disabled')).not.toBe('true');
    await choose(2);
    await tap('Continue');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(2);
    expect(host.querySelector('[data-testid="add-pick-import-flags"]')).toBeNull();
    await tap('Save parlay');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      legs: [sixLegs()[1]?.pick, sixLegs()[2]?.pick],
    });
  });

  it('continues one selected leg as a single pick', async () => {
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    await choose(0);
    await tap('Continue');
    expect(host.textContent).toContain('Check the pick we read from your screenshot.');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', { pick: sixLegs()[0]?.pick });
  });

  it('keeps unsupported legs outside selection and preserves Needs your check', async () => {
    importResponse = async () => ({
      kind: 'parlay',
      legs: [...sixLegs(), FLAGGED_LEG],
      imports_left: 3,
    });
    await tap('Import from screenshot');
    expect(choices()).toHaveLength(6);
    expect(host.textContent).toContain('NEEDS YOUR CHECK');
    await choose(0);
    await tap('Continue');
    expect(pressable('Add a pick').getAttribute('aria-disabled')).toBe('true');
    await tap('Dismiss');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', { pick: sixLegs()[0]?.pick });
  });

  it('keeps exactly-at-cap imports on the existing parlay review', async () => {
    importResponse = async () => ({
      kind: 'parlay',
      legs: [KITTLE_LEG, SF_ML_LEG],
      imports_left: 3,
    });
    await tap('Import from screenshot');
    expect(host.querySelector('[data-testid="add-pick-import-choices"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(2);
    expect(pressable('Save parlay').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('never limits Pro imports', async () => {
    act(() => root.unmount());
    host.remove();
    tier = 'pro';
    picksPage = { ...picksPage, free_slots_used: 3 };
    await render();
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    expect(host.querySelector('[data-testid="add-pick-import-choices"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(6);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('waits for the server allowance and handles zero picks left after import starts', async () => {
    act(() => root.unmount());
    host.remove();
    let resolveAllowance!: (value: unknown) => void;
    api.get.mockImplementation((path) =>
      path.startsWith('/picks')
        ? new Promise((resolve) => {
            resolveAllowance = resolve;
          })
        : routeGet(path),
    );
    await render();
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    expect(host.textContent).toContain('Loading your free picks left');
    expect(host.querySelector('[data-testid="add-pick-parlay"]')).toBeNull();
    await act(async () => resolveAllowance({ ...picksPage, free_slots_used: 3 }));
    await flush();
    expect(host.textContent).toContain('You have 0 free picks left this week.');
    expect(choices().every((node) => node.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(pressable('Continue').getAttribute('aria-disabled')).toBe('true');
    expect(openUpgrade).not.toHaveBeenCalled();
    await tap('Upgrade to Pro');
    expect(openUpgrade).toHaveBeenCalledWith('stake_limit_free');
    expect(api.post.mock.calls.filter(([path]) => path === '/picks')).toHaveLength(0);
  });

  it('uses singular copy and caps selection when only one free pick remains', async () => {
    act(() => root.unmount());
    host.remove();
    picksPage = { ...picksPage, free_slots_used: 2 };
    await render();
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    expect(host.textContent).toContain('You have 1 free pick left this week. Choose up to 1');
    await choose(0);
    expect(choices()[1]?.getAttribute('aria-disabled')).toBe('true');
    await tap('Continue');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', { pick: sixLegs()[0]?.pick });
  });

  it('retains the import after an allowance failure and retries without using another import', async () => {
    act(() => root.unmount());
    host.remove();
    api.get.mockImplementation((path) =>
      path.startsWith('/picks') ? Promise.reject(new Error('offline')) : routeGet(path),
    );
    await render();
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    expect(host.textContent).toContain('Could not load your free picks left.');
    expect(choices()).toHaveLength(0);
    api.get.mockImplementation(routeGet);
    await tap('Retry');
    expect(choices()).toHaveLength(6);
    expect(api.post.mock.calls.filter(([path]) => path === '/picks/import')).toHaveLength(1);
  });

  it('preserves the authoritative cap error when allowance changes before save', async () => {
    importResponse = async () => ({ kind: 'parlay', legs: sixLegs(), imports_left: 3 });
    await tap('Import from screenshot');
    await choose(0);
    await tap('Continue');
    api.post.mockRejectedValueOnce(
      new ApiRequestError(403, 'stake_limit_free', 'Free pick limit reached.'),
    );
    await tap('Add a pick');
    expect(openUpgrade).toHaveBeenCalledWith('stake_limit_free');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('puts a parlay’s legs on the slip, holds Save until flagged legs are dismissed, and edits a leg', async () => {
    importResponse = async () => ({
      kind: 'parlay',
      legs: [KITTLE_LEG, FLAGGED_LEG, SF_ML_LEG],
      imports_left: 3,
    });
    await tap('Import from screenshot');

    expect(slipText()).toContain('LEG 1');
    expect(slipText()).toContain('G. Kittle over 59.5 rec yds');
    expect(slipText()).toContain('SF ML');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(2);
    const flags = host.querySelector('[data-testid="add-pick-import-flags"]')?.textContent ?? '';
    expect(flags).toContain('Correct score 24-17');
    expect(flags).toContain('Pivot can’t track this kind of pick yet.');
    expect(pressable('Save parlay').getAttribute('aria-disabled')).toBe('true');

    // Edit leg 1: the line step opens filled in, and the leg is replaced in place.
    act(() => {
      host.querySelector<HTMLElement>('[aria-label^="Edit leg 1"]')?.click();
    });
    await flush();
    await type('add-pick-line-field', '70.5');
    await tap('Continue');
    await tap('Update leg');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(2);
    expect(slipText()).toContain('G. Kittle over 70.5 rec yds');
    expect(slipText()).not.toContain('59.5');

    await tap('Dismiss');
    expect(host.querySelector('[data-testid="add-pick-import-flags"]')).toBeNull();
    await tap('Save parlay');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      legs: [
        {
          gameId: 'g-sf-sea',
          playerId: 'p-kittle',
          condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 70.5 },
        },
        { gameId: 'g-sf-sea', teamId: 'sf-id', condition: { type: 'MONEYLINE', side: 'TEAM' } },
      ],
    });
  });

  it('explains a single pick it could not match, and stays on the type step', async () => {
    importResponse = async () => ({ kind: 'single', legs: [FLAGGED_LEG], imports_left: 4 });
    await tap('Import from screenshot');
    expect(host.querySelector('[data-testid="add-pick-import-error"]')?.textContent).toBe(
      'We read “Correct score 24-17”. Pivot can’t track this kind of pick yet.',
    );
    expect(host.textContent).toContain('Player prop');
  });

  it('shows the daily limit message from the API', async () => {
    importResponse = async () => {
      throw new ApiRequestError(
        429,
        'slip_import_limit',
        'You’ve used today’s 5 screenshot imports. You can still add picks yourself, imports reset tomorrow, and Pro includes more.',
      );
    };
    await tap('Import from screenshot');
    expect(host.querySelector('[data-testid="add-pick-import-error"]')?.textContent).toContain(
      'You’ve used today’s 5 screenshot imports.',
    );
  });

  it('sends a capped free account to upgrade instead of the picker', async () => {
    act(() => root.unmount());
    host.remove();
    picksPage = { ...picksPage, free_slots_used: 3 };
    await render();
    expect(host.textContent).toContain('No free bets left · Upgrade');
    await tap('Import from screenshot');
    expect(openUpgrade).toHaveBeenCalledWith('stake_limit_free');
    expect(picker.pickSlipImage).not.toHaveBeenCalled();
  });
});
