// @vitest-environment happy-dom
import { act, type EffectCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { fetchMe } from '../lib/me';
import HomeScreen from '../app/(app)/(tabs)/index';
import {
  MNF_AIRINGS,
  MNF_BROADCAST,
  MNF_GAME_ID,
  MNF_HALFTIME_LIVE,
} from '../fixtures/mnfHalftime';
import type { CurrentFlag, FlagsCurrentResponse } from '../lib/gameDisplay';
import type { LeagueSummary, LineupResponse } from '../lib/leagues';
import { LIVE_FEED_PAUSED_BANNER } from '../lib/liveFeed';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';

vi.mock('react-native', () => import('react-native-web'));

// Any font key resolves, so components added later do not break this test. The real module loads
// expo-font (needs `__DEV__`).
vi.mock('../lib/fonts', () => ({
  fonts: new Proxy({}, { get: () => 'sans-serif' }),
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../lib/apiClient', () => {
  class ApiRequestError extends Error {}
  return { apiClient: { get: api.get }, ApiRequestError };
});

vi.mock('../lib/me', () => ({
  fetchMe: vi.fn(async () => ({
    user_id: 'u1',
    email: 'a@b.com',
    subscription_tier: 'free',
    preferences: { watchedLeagueIds: [] },
    app_presence: [],
    is_demo: false,
  })),
}));

vi.mock('../lib/picksClient', () => ({
  fetchWatchPicks: vi.fn(async () => ({ stakes: [] })),
}));

vi.mock('../lib/useHomeRealtime', () => ({ useHomeRealtime: () => undefined }));

const switching = vi.hoisted(() => ({ switchToGame: vi.fn() }));
vi.mock('../contexts/SwitchingContext', () => ({
  useSwitching: () => switching,
}));

const LEAGUE: LeagueSummary = {
  league_id: 'lg-1',
  platform: 'sleeper',
  name: 'Test League',
  sport: 'nfl',
  season_year: 2026,
  last_synced_at: null,
};
const gate = vi.hoisted(() => ({
  value: {
    status: 'ready',
    leagues: [] as unknown[],
    leaguesRevision: 0,
    refreshLeagues: vi.fn(async () => [] as unknown[]),
  },
}));
gate.value.leagues = [LEAGUE];
vi.mock('../contexts/LeaguesGateContext', () => ({
  useLeaguesGate: () => gate.value,
}));

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    useRouter: () => ({ push: () => undefined, replace: () => undefined }),
    useGlobalSearchParams: () => ({}),
    useFocusEffect: (effect: EffectCallback) => {
      React.useEffect(effect, [effect]);
    },
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Not under test here: the lineup picker, the MY CARD list and the BOARD | MY CARD control.
vi.mock('../components/ActiveLineupPicker', () => ({ ActiveLineupPicker: () => null }));
vi.mock('../components/MyCardList', () => ({ MyCardList: () => null }));
vi.mock('../components/HomeSegmentRow', () => ({
  HomeSegmentRow: () => null,
  ManageLineupLink: () => null,
}));

const OPP_GAME_ID = 'game-opp';

const LIVE_SF: LiveGame = {
  ...MNF_HALFTIME_LIVE,
  quarter: 3,
  time_remaining_sec: 420,
  possession_team: 'SF',
  yards_to_endzone: 40,
  down: 2,
  distance: 7,
};

const LIVE_OPP: LiveGame = {
  game_id: OPP_GAME_ID,
  status: 'in_progress',
  scheduled_start: '2026-10-20T00:15:00+00:00',
  home_team: 'DEN',
  away_team: 'KC',
  home_team_name: 'Broncos',
  away_team_name: 'Chiefs',
  home_team_primary_color: '#FB4F14',
  home_team_secondary_color: '#002244',
  away_team_primary_color: '#E31837',
  away_team_secondary_color: '#FFB81C',
  score: { home: 7, away: 10 },
  quarter: 3,
  time_remaining_sec: 300,
  possession_team: 'KC',
  yards_to_endzone: 30,
  down: 3,
  distance: 4,
  in_red_zone: false,
};

function weekGameFor(game: LiveGame): ScheduleGame {
  return {
    game_id: game.game_id,
    status: 'in_progress',
    scheduled_start: game.scheduled_start,
    home_team: game.home_team,
    away_team: game.away_team,
    home_team_name: game.home_team_name,
    away_team_name: game.away_team_name,
    home_team_primary_color: game.home_team_primary_color,
    home_team_secondary_color: game.home_team_secondary_color,
    away_team_primary_color: game.away_team_primary_color,
    away_team_secondary_color: game.away_team_secondary_color,
    broadcasts: [MNF_BROADCAST],
    airings: MNF_AIRINGS,
  };
}

const LINEUP: LineupResponse = {
  league_id: LEAGUE.league_id,
  week: 6,
  last_synced_at: null,
  slots: [
    {
      slot_id: 'slot-1',
      slot_type: 'starter',
      position_in_lineup: 'TE',
      is_star: false,
      player: {
        player_id: 'sf-kittle',
        first_name: 'George',
        last_name: 'Kittle',
        position: 'TE',
        team: { teamId: 'team-sf', abbreviation: 'SF', name: '49ers' },
      },
    },
  ],
};

function summaryOf(game: LiveGame): CurrentFlag['game'] {
  return {
    home_team: game.home_team,
    away_team: game.away_team,
    home_team_name: game.home_team_name,
    away_team_name: game.away_team_name,
    home_team_primary_color: game.home_team_primary_color,
    home_team_secondary_color: game.home_team_secondary_color,
    away_team_primary_color: game.away_team_primary_color,
    away_team_secondary_color: game.away_team_secondary_color,
    score: game.score,
    quarter: game.quarter,
    time_remaining_sec: game.time_remaining_sec,
    possession_team: game.possession_team,
    yards_to_endzone: game.yards_to_endzone,
    down: game.down,
    distance: game.distance,
    in_red_zone: game.in_red_zone,
  };
}

const OWN_FLAG: CurrentFlag = {
  game_id: MNF_GAME_ID,
  priority_score: 10,
  reasons: [],
  flagged_players: [
    { player_id: 'sf-kittle', first_name: 'George', last_name: 'Kittle', position: 'TE' },
  ],
  game: summaryOf(LIVE_SF),
  recommended_action: 'switch_primary',
};

interface Scenario {
  live: LiveGame[];
  week: ScheduleGame[];
  flags: FlagsCurrentResponse;
}

function state2(liveFeedOk?: boolean): Scenario {
  return {
    live: [MNF_HALFTIME_LIVE],
    week: [weekGameFor(MNF_HALFTIME_LIVE)],
    flags: {
      flags: [],
      generated_at: '2026-10-20T01:50:00.000Z',
      ...(liveFeedOk === undefined ? {} : { live_feed_ok: liveFeedOk }),
    },
  };
}

function state1(liveFeedOk?: boolean): Scenario {
  return {
    live: [LIVE_SF, LIVE_OPP],
    week: [weekGameFor(LIVE_SF), weekGameFor(LIVE_OPP)],
    flags: {
      flags: [OWN_FLAG],
      generated_at: '2026-10-20T01:50:00.000Z',
      opponent_flags: [
        {
          game_id: OPP_GAME_ID,
          priority_score: 5,
          player_ids: ['opp-1'],
          reasons: [],
          players: [{ player_id: 'opp-1', first_name: 'Pat', last_name: 'Smith' }],
        },
      ],
      opponent_game_ids: [OPP_GAME_ID],
      ...(liveFeedOk === undefined ? {} : { live_feed_ok: liveFeedOk }),
    },
  };
}

function useScenario(scenario: Scenario) {
  api.get.mockImplementation(async (path: string) => {
    if (path === '/state/nfl') {
      return {
        season: '2026',
        week: 6,
        season_type: 'regular',
        season_start_date: null,
        preseason_start: null,
        regular_season_start: null,
        display_phase: 'regular',
      };
    }
    if (path.startsWith('/leagues/')) return LINEUP;
    if (path === '/games/live') return { games: scenario.live };
    if (path.startsWith('/games?week=')) return { week: 6, games: scenario.week };
    if (path === '/flags/current') return scenario.flags;
    if (/^\/games\/[^/]+\/broadcasts$/.test(path)) return { broadcasts: [MNF_BROADCAST] };
    throw new Error(`unexpected GET ${path}`);
  });
}

let container: HTMLDivElement;
let root: Root;
let warn: MockInstance | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  switching.switchToGame.mockReset();
  api.get.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  warn?.mockRestore();
});

const text = () => container.textContent ?? '';

/** Mounts Home and lets the cold-start fetch chain finish. */
async function mountHome(scenario: Scenario) {
  useScenario(scenario);
  await act(async () => {
    root.render(<HomeScreen />);
  });
  for (let i = 0; i < 50 && !text().includes('Your live games'); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function leafWithText(label: string): HTMLElement {
  const leaf = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!leaf) throw new Error(`no element with text "${label}"`);
  return leaf;
}

/** Inline opacity of the element and every ancestor. Registered styles are classes, not inline. */
function opacitiesAbove(el: HTMLElement): string[] {
  const found: string[] = [];
  for (let node: HTMLElement | null = el; node && node !== container; node = node.parentElement) {
    if (node.style.opacity !== '') found.push(node.style.opacity);
  }
  return found;
}

describe('Home live day (real screen)', () => {
  it('hands off to shaped placeholders while Home data is pending, then renders the games', async () => {
    vi.useFakeTimers();
    try {
      useScenario(state2());
      let release!: (value: Awaited<ReturnType<typeof fetchMe>>) => void;
      const profile = await fetchMe();
      vi.mocked(fetchMe).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await act(async () => root.render(<HomeScreen />));
      expect(container.querySelector('[role="progressbar"]')).toBeNull();
      await act(async () => vi.advanceTimersByTime(150));
      expect(container.querySelector('[data-testid="home-cold-loading"]')).toBeTruthy();
      expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
      expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe(
        'Loading',
      );
      expect(container.querySelector('[data-testid="yard-line-loader"]')).toBeNull();
      expect(text()).not.toContain('Finding your games…');
      await act(async () => {
        release(profile);
      });
      expect(container.querySelector('[data-testid="home-cold-loading"]')).toBeTruthy();
      await act(async () => vi.advanceTimersByTime(300));
      expect(container.querySelector('[data-testid="home-cold-loading"]')).toBeNull();
      expect(text()).toContain('Your live games');
    } finally {
      vi.useRealTimers();
    }
  });

  it('state2: live pick games and no flags render the live cards, not an Also flagged row', async () => {
    await mountHome(state2());
    expect(text()).toContain('● LIVE · 1 GAME');
    expect(text()).toContain('Your live games');
    expect(text()).toContain('LIVE · YOUR GAME');
    expect(text()).toContain('George Kittle TE · SIDELINE');
    expect(text()).toContain('Watch on YouTube TV');
    expect(text()).not.toContain('NOW ACTIVE');
    expect(text()).not.toContain('Also flagged');
  });

  it('state1: a flagged game is the NOW ACTIVE hero and other flagged games get Also flagged tiles', async () => {
    await mountHome(state1());
    expect(text()).toContain('● LIVE · 2 GAMES');
    expect(text()).toContain('Your live games');
    expect(text()).toContain('NOW ACTIVE');
    expect(text()).toContain('George Kittle TE · ON FIELD');
    expect(text()).toContain('Also flagged');
    const tile = container.querySelector(`#pivot-game-${OPP_GAME_ID}`);
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain('KC');
    expect(tile?.textContent).toContain('DEN');
    expect(tile?.textContent).toContain('OPPONENT · Pat Smith');
    // The user's own flagged game is the hero card, not a tile.
    expect(container.querySelector(`#pivot-game-${MNF_GAME_ID}`)?.textContent ?? '').not.toContain(
      'OPPONENT',
    );
  });

  it('state1: Switch on an Also flagged tile opens that game', async () => {
    await mountHome(state1());
    const button = container.querySelector('[aria-label="Switch to KC at DEN"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(switching.switchToGame).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: OPP_GAME_ID,
        deepLinkUrl: MNF_BROADCAST.deep_link_url,
      }),
    );
  });

  it('copy says pick, never stake, in either live state', async () => {
    await mountHome(state2());
    expect(text()).not.toMatch(/stake/i);
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await mountHome(state1());
    expect(text()).not.toMatch(/stake/i);
  });

  it('live_feed_ok false shows the paused banner and dims the live and Also flagged cards', async () => {
    await mountHome(state1(false));
    expect(text()).toContain(LIVE_FEED_PAUSED_BANNER);
    const dim = String(theme.opacity.disabled);
    expect(opacitiesAbove(leafWithText('Your live games'))).toContain(dim);
    expect(opacitiesAbove(leafWithText('Also flagged'))).toContain(dim);
  });

  it.each([
    ['true', true],
    ['missing', undefined],
  ])('live_feed_ok %s shows no banner and does not dim the cards', async (_label, liveFeedOk) => {
    await mountHome(state1(liveFeedOk));
    expect(text()).not.toContain(LIVE_FEED_PAUSED_BANNER);
    expect(text()).not.toContain('Live updates paused');
    const dim = String(theme.opacity.disabled);
    expect(opacitiesAbove(leafWithText('Your live games'))).not.toContain(dim);
    expect(opacitiesAbove(leafWithText('Also flagged'))).not.toContain(dim);
  });

  it('live_feed_ok false also pauses state2', async () => {
    await mountHome(state2(false));
    expect(text()).toContain(LIVE_FEED_PAUSED_BANNER);
    expect(opacitiesAbove(leafWithText('Your live games'))).toContain(
      String(theme.opacity.disabled),
    );
  });
});
