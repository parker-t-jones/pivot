// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleGame } from '../lib/schedule';
import { FeaturedStakeCard } from './FeaturedStakeCard';

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

const game: ScheduleGame = {
  game_id: 'mnf',
  status: 'scheduled',
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

describe('FeaturedStakeCard eyebrow', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  it('defaults to TOP GAME', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(createElement(FeaturedStakeCard, { game }));
    });
    const text = host.textContent ?? '';
    expect(text).toContain('TOP GAME');
    expect(text).not.toMatch(/stake/i);
  });
});
