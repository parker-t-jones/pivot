// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function routeGet(path: string): Promise<unknown> {
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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('add a pick flow', () => {
  let root: Root;
  let host: HTMLDivElement;
  const onDismiss = vi.fn();

  beforeEach(async () => {
    picksPage = { week: 11, free_limit: 3, free_slots_used: 1, picks: [], slips: [] };
    tier = 'free';
    api.get.mockImplementation(routeGet);
    api.post.mockImplementation(async () => ({}));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<AddPickFlow onDismiss={onDismiss} />);
    });
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  /** The innermost pressable whose text contains `text`. */
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

  async function tapTestId(testId: string): Promise<void> {
    const node = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!node) throw new Error(`missing ${testId}`);
    act(() => {
      node.click();
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

  function eyebrow(): string {
    return host.textContent?.match(/ADD A PICK[^a-z]*?(?=YOUR SLIP|Demo|$)/)?.[0] ?? '';
  }

  it('lists the new types and counts free bets left from GET /picks', () => {
    const text = host.textContent ?? '';
    expect(text).toContain('2 free bets left this week');
    expect(text).toContain('Player prop');
    expect(text).toContain('Team & game props');
    expect(text).toContain('Parlay');
    expect(api.get).toHaveBeenCalledWith('/picks?week=11');
    expect(text.toLowerCase()).not.toContain('stake');
  });

  it('builds a player prop from search to save, with the readout in plain words', async () => {
    await tap('Player prop');
    expect(eyebrow()).toContain('PLAYER PROP · STEP 2 OF 5');
    await type('player-search-field', 'kit');
    expect(api.get).toHaveBeenCalledWith('/players/search?q=kit');
    // A team defense has no props, so it isn't offered.
    expect(host.textContent).not.toContain('San Francisco 49ers');
    expect(host.textContent).toContain('TE · SF · SF @ SEA');

    await tap('George Kittle');
    expect(slipText()).toContain('G. Kittle');
    expect(host.textContent).toContain('Receiving yards');
    expect(host.textContent).not.toContain('Passing yards');

    await tap('Receiving yards');
    expect(slipText()).toContain('G. Kittle · Receiving yards');
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('49.5');
    await tap('Over');
    await type('add-pick-line-field', '60.5');
    expect(host.textContent).toContain('Kittle needs 61 or more receiving yards');
    expect(slipText()).toContain('G. Kittle over 60.5 rec yds');

    await tap('Continue');
    expect(host.textContent).toContain('Uses 1 of your 2 free bets');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      pick: {
        gameId: 'g-sf-sea',
        playerId: 'p-kittle',
        condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 60.5 },
      },
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('opens a game in progress to a live bet, labeled Live, and not to survivor', async () => {
    await tap('Spread');
    expect(host.textContent).toContain('Live');
    await tapTestId('add-pick-side-g-buf-kc-KC');
    expect(eyebrow()).toContain('SPREAD · STEP 3 OF 4');
    expect(slipText()).toContain('Live');

    await tap('Back');
    await tap('Back');
    await tap('Survivor');
    expect(host.textContent).toContain('Started');
    expect(host.textContent).not.toContain('Live');
    await tapTestId('add-pick-side-g-buf-kc-KC');
    expect(eyebrow()).toContain('SURVIVOR · STEP 2 OF 3');
  });

  it('saves a quarter total through the team and game props', async () => {
    await tap('Team & game props');
    await tap('Quarter or half total');
    await tapTestId('add-pick-game-g-sf-sea');
    expect(pressable('Continue').getAttribute('aria-disabled')).toBe('true');
    await tap('1H');
    await tap('Under');
    await type('add-pick-line-field', '20.5');
    expect(host.textContent).toContain('Combined score in the 1st half must be 20 or fewer');
    await tap('Continue');
    await tap('Add a pick');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      pick: {
        gameId: 'g-sf-sea',
        condition: { type: 'TOTAL_UNDER', line: 20.5, segment: 'H1' },
      },
    });
  });

  it('adds parlay legs one by one, shows every leg on the slip, and saves one slip', async () => {
    await tap('Parlay');
    expect(eyebrow()).toBe('ADD A PICK · PARLAY');
    expect(host.textContent).toContain('Add at least 2 legs.');
    expect(pressable('Save parlay').getAttribute('aria-disabled')).toBe('true');

    await tap('Add a leg');
    expect(host.textContent).not.toContain('Survivor');
    expect(host.textContent).not.toContain('free bets left');
    await tap('Moneyline');
    expect(eyebrow()).toContain('PARLAY · LEG 1 · STEP 2 OF 3');
    await tapTestId('add-pick-side-g-sf-sea-SF');
    await tap('Add to parlay');
    expect(slipText()).toContain('LEG 1');
    expect(slipText()).toContain('SF ML');

    // The same leg twice is refused before it reaches the API.
    await tap('Add a leg');
    await tap('Moneyline');
    await tapTestId('add-pick-side-g-sf-sea-SF');
    await tap('Add to parlay');
    expect(host.textContent).toContain('That leg is already in this parlay.');
    await tap('Back');
    await tapTestId('add-pick-side-g-buf-kc-BUF');
    await tap('Add to parlay');

    expect(slipText()).toContain('LEG 2');
    expect(slipText()).toContain('Parlay · 2 of 12 legs');
    expect(host.textContent).toContain('This parlay uses 2 of your 2 remaining free picks.');
    await tap('Add a leg');
    expect(openUpgrade).toHaveBeenCalledWith('stake_limit_free');
    expect(host.textContent).toContain('Each parlay leg uses one free pick.');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled();
    await tap('Save parlay');
    expect(api.post).toHaveBeenCalledWith('/picks', {
      legs: [
        { gameId: 'g-sf-sea', teamId: 'sf-id', condition: { type: 'MONEYLINE', side: 'TEAM' } },
        { gameId: 'g-buf-kc', teamId: 'buf-id', condition: { type: 'MONEYLINE', side: 'TEAM' } },
      ],
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('removes a parlay leg from the slip', async () => {
    await tap('Parlay');
    await tap('Add a leg');
    await tap('Moneyline');
    await tapTestId('add-pick-side-g-sf-sea-SF');
    await tap('Add to parlay');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(1);
    await tap('Remove');
    expect(host.querySelectorAll('[data-testid="add-pick-slip-leg"]')).toHaveLength(0);
  });

  it('sends a capped free account to upgrade from the new types', async () => {
    act(() => root.unmount());
    picksPage = { ...picksPage, free_slots_used: 3 };
    root = createRoot(host);
    act(() => {
      root.render(<AddPickFlow onDismiss={onDismiss} />);
    });
    await flush();
    expect(host.textContent).toContain('0 free bets left this week');
    await tap('Parlay');
    await tap('Player prop');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('0 free bets left this week');
  });
});
