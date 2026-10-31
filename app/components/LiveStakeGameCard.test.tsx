// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MNF_HALFTIME_LIVE, MNF_STARTERS } from '../fixtures/mnfHalftime';
import { liveStakeChips } from '../lib/liveStakeCards';
import type { LiveGame } from '../lib/schedule';
import { scoreBlockWash } from '../lib/teamColors';
import { theme } from '../lib/theme';
import { LiveStakeGameCard } from './LiveStakeGameCard';

vi.mock('react-native', () => import('react-native-web'));

vi.mock('../lib/fonts', () => ({
  fonts: {
    teamNickname: 'sans-serif',
    sansBold: 'sans-serif',
    sansSemiBold: 'sans-serif',
    monoBold: 'monospace',
    monoSemiBold: 'monospace',
    monoMedium: 'monospace',
  },
}));

function render(node: ReturnType<typeof createElement>): Root {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return root;
}

function modelFor(game: LiveGame, active: boolean) {
  const chips = liveStakeChips({
    game,
    players: [...MNF_STARTERS],
    bets: [],
    activePlayerIds: active ? new Set(MNF_STARTERS.map((player) => player.playerId)) : undefined,
  });
  return {
    game,
    eyebrow: active ? ('NOW ACTIVE' as const) : ('LIVE · YOUR GAME' as const),
    active,
    chips: chips.chips,
    extraChips: chips.extraChips,
    buttonLabel: 'Watch on YouTube TV',
  };
}

describe('LiveStakeGameCard', () => {
  let root: Root | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('renders the halftime card with an outlined watch button and no gauge', () => {
    const onSwitch = vi.fn();
    root = render(
      createElement(LiveStakeGameCard, {
        model: modelFor(
          {
            ...MNF_HALFTIME_LIVE,
            away_team_primary_color: '#111111',
            home_team_primary_color: '#111111',
          },
          false,
        ),
        onSwitch,
      }),
    );
    expect(document.body.textContent).toContain('LIVE · YOUR GAME');
    expect(document.body.textContent).toContain('HALFTIME');
    expect(document.body.textContent).toContain('Commanders D/ST · SIDELINE');
    expect(document.body.textContent).not.toContain('RED ZONE');
    const button = document.querySelector('[role="button"]');
    expect(button?.textContent).toContain('Watch on YouTube TV');
    const left = document.querySelector('[data-testid="live-score-left"]');
    expect(left?.getAttribute('style') ?? '').toContain(
      scoreBlockWash('WAS', theme.colors.background),
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('fills the button and shows RED ZONE when a stake is active inside the 20', () => {
    const game: LiveGame = {
      ...MNF_HALFTIME_LIVE,
      possession_team: 'SF',
      yards_to_endzone: 12,
      down: 1,
      distance: 10,
      quarter: 3,
      time_remaining_sec: 420,
      in_red_zone: true,
    };
    root = render(
      createElement(LiveStakeGameCard, { model: modelFor(game, true), onSwitch: vi.fn() }),
    );
    expect(document.body.textContent).toContain('NOW ACTIVE');
    expect(document.body.textContent).toContain('RED ZONE');
    expect(document.body.textContent).toContain('George Kittle TE · ON FIELD');
    expect(document.body.textContent).toContain('Q3 · 7:00');
    const button = Array.from(document.querySelectorAll('[role="button"]')).find((node) =>
      node.textContent?.includes('Watch on YouTube TV'),
    );
    const style = button?.getAttribute('style') ?? '';
    const classStyle = button?.className ? getComputedStyle(button).backgroundColor : '';
    expect(`${style} ${classStyle}`).toMatch(/245,\s*160,\s*24|#F5A018|rgb\(245,\s*160,\s*24\)/);
  });

  it('shows text and no button when the game is not on the user services', () => {
    root = render(
      createElement(LiveStakeGameCard, {
        model: {
          ...modelFor(MNF_HALFTIME_LIVE, false),
          buttonLabel: 'Not on your services',
          opensLink: false,
        },
        onSwitch: vi.fn(),
      }),
    );
    expect(document.body.textContent).toContain('Not on your services');
    expect(document.body.textContent).not.toContain('Watch on');
  });

  it('lists other ways to watch under the primary button', () => {
    const onSwitchLocal = vi.fn();
    root = render(
      createElement(LiveStakeGameCard, {
        model: {
          ...modelFor(MNF_HALFTIME_LIVE, false),
          alternates: [
            {
              service: '',
              deep_link_url: 'https://www.fox.com/live/channels',
              requires_subscription: true,
              user_has_subscription: true,
              typical_lag_seconds: 0,
              preferred: false,
              network: 'fox',
              market_confidence: 'national',
              label: 'FOX channel guide',
            },
          ],
        },
        onSwitch: vi.fn(),
        onSwitchLocal,
      }),
    );
    const other = Array.from(document.querySelectorAll('[role="button"]')).find((node) =>
      node.textContent?.includes('Other ways to watch'),
    );
    expect(other).toBeTruthy();
    act(() => {
      other?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const channel = Array.from(document.querySelectorAll('[role="button"]')).find((node) =>
      node.textContent?.includes('FOX channel guide'),
    );
    act(() => {
      channel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSwitchLocal).toHaveBeenCalledOnce();
  });
});
