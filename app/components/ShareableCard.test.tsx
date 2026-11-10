// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickCardModel } from '../lib/pickCard';
import { pickCardShareContent, weekCardShareContent } from '../lib/shareCard';
import { weekCardModel } from '../lib/weekCardModel';
import { ShareableCard } from './ShareableCard';

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

describe('ShareableCard', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('renders the week, game count, and all four cells for a week-card fixture', () => {
    const content = weekCardShareContent(
      weekCardModel({
        starterCount: 9,
        opponentStatus: 'on',
        betCount: 1,
        survivorCount: 1,
        isPro: false,
        week: 9,
        gameCount: 6,
      }),
    );
    act(() => {
      root.render(createElement(ShareableCard, { content }));
    });
    const text = host.textContent ?? '';
    expect(text).toContain('YOUR WEEK 9 CARD');
    expect(text).toContain('6 GAMES');
    for (const label of ['Fantasy', 'Opponent', 'Bets & props', 'Survivor pool']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('PIVOT');
    // No live-UI chrome: no button role in the exported card.
    expect(host.querySelectorAll('[role="button"]').length).toBe(0);
  });

  it('renders the team matchup, pick label, and week for a pick-card fixture', () => {
    const pick: PickCardModel = {
      eyebrow: 'SPREAD',
      pick: 'DET −3.5',
      awayTeam: 'DET',
      homeTeam: 'GB',
      matchup: 'DET @ GB',
      status: 'FINAL',
      phase: 'final',
      progress: null,
      axisLabel: '',
      detail: null,
      legs: [],
      hit: false,
      bar: null,
    };
    act(() => {
      root.render(createElement(ShareableCard, { content: pickCardShareContent(pick, 9) }));
    });
    const text = host.textContent ?? '';
    expect(text).toContain('DET @ GB');
    expect(text).toContain('DET −3.5');
    expect(text).toContain('WEEK 9');
  });
});
