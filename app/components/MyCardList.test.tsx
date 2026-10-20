// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardWindowGroup } from '../lib/board';
import type { LineupGameGroup } from '../lib/homeState';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import { MyCardList } from './MyCardList';

vi.mock('react-native', () => import('react-native-web'));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock('../lib/apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
}));

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

vi.mock('../contexts/GameLinksContext', () => ({
  useGameLinks: () => ({
    available: true,
    get: () => ({
      gameId: 'mnf',
      url: 'https://tv.youtube.com/watch/very-long-saved-link-that-must-not-eat-the-matchup',
      host: 'tv.youtube.com',
      updated_at: '2026-10-20T00:31:23.885Z',
    }),
    save: async () => undefined,
    remove: async () => undefined,
  }),
}));

const STAKE_LINE = 'George Kittle needs a very long stake line that stays whole';

const schedule: ScheduleGame = {
  game_id: 'mnf',
  status: 'in_progress',
  scheduled_start: '2026-10-20T00:15:00Z',
  home_team: 'SF',
  away_team: 'WAS',
  home_team_name: '49ers',
  away_team_name: 'Commanders',
  home_team_primary_color: '#AA0000',
  home_team_secondary_color: '#B3995D',
  away_team_primary_color: '#5A1414',
  away_team_secondary_color: '#FFB612',
  broadcasts: [],
  airings: [],
};

const groups: BoardWindowGroup[] = [
  {
    label: 'MONDAY',
    earliestKickoff: new Date('2026-10-20T00:15:00Z'),
    rows: [
      {
        gameId: 'mnf',
        kickoff: new Date('2026-10-20T00:15:00Z'),
        status: 'in_progress',
        awayTeamId: 'WAS',
        homeTeamId: 'SF',
        awayTeamColor: '#5A1414',
        homeTeamColor: '#AA0000',
        network: 'ESPN',
        stakeCount: 1,
        stripeSide: 'away',
      },
    ],
  },
];

const lineupGroups: LineupGameGroup[] = [
  {
    game: schedule,
    players: [
      {
        player_id: 'kittle',
        first_name: 'George',
        last_name: 'Kittle',
        position: 'TE',
        team_abbreviation: 'SF',
      },
    ],
  },
];

const live: LiveGame = {
  game_id: 'mnf',
  status: 'in_progress',
  scheduled_start: '2026-10-20T00:15:00Z',
  home_team: 'SF',
  away_team: 'WAS',
  home_team_name: '49ers',
  away_team_name: 'Commanders',
  home_team_primary_color: '#AA0000',
  home_team_secondary_color: '#B3995D',
  away_team_primary_color: '#5A1414',
  away_team_secondary_color: '#FFB612',
  score: { home: 20, away: 3 },
  quarter: 2,
  time_remaining_sec: 0,
  possession_team: null,
  yards_to_endzone: null,
  down: null,
  distance: null,
  in_red_zone: false,
};

describe('MyCardList saved link', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  it('keeps the matchup and the stake line whole beside a long saved link', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        createElement(MyCardList, {
          betRefs: [
            {
              kind: 'bet',
              gameId: 'mnf',
              teamId: 'SF',
              label: STAKE_LINE,
              eyebrow: 'BET',
            },
          ],
          groups,
          lineupGroups,
          liveGames: [live],
          part: 'cards',
        }),
      );
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('WAS @ SF');
    expect(text).toContain(STAKE_LINE);
    expect(text).toContain('HALFTIME');
    expect(text).toContain('tv.youtube.com');
    expect(text).not.toContain('WAS @…');
  });
});
