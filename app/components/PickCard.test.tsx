// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pickCardModel, type PickCardStake } from '../lib/pickCard';
import { theme } from '../lib/theme';
import { PickCard } from './PickCard';

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

const NOW = new Date('2026-11-08T17:00:00.000Z');
const game = {
  scheduled_start: '2026-11-08T18:00:00.000Z',
  status: 'scheduled',
  home_team_id: 'gb',
  away_team_id: 'det',
  home_team: 'GB',
  away_team: 'DET',
};
const teams = [
  { teamId: 'gb', abbreviation: 'GB' },
  { teamId: 'det', abbreviation: 'DET' },
];
const liveScore = {
  game_id: 'g1',
  score: { home: 7, away: 14 },
  quarter: 2,
  time_remaining_sec: 300,
};

const STAKES: Record<string, PickCardStake> = {
  SPREAD: {
    game_id: 'g1',
    subject: { type: 'TEAM', teamId: 'det' },
    condition: { type: 'SPREAD', line: -3.5 },
    game,
  },
  TOTAL: {
    game_id: 'g1',
    subject: { type: 'GAME' },
    condition: { type: 'TOTAL_OVER', line: 84.5 },
    game,
  },
  MONEYLINE: {
    game_id: 'g1',
    subject: { type: 'TEAM', teamId: 'det' },
    condition: { type: 'MONEYLINE' },
    game,
  },
  SURVIVOR: {
    game_id: 'g1',
    subject: { type: 'TEAM', teamId: 'det' },
    condition: { type: 'SURVIVOR' },
    game,
  },
};
const PICKS: Record<string, string> = {
  SPREAD: 'DET −3.5',
  TOTAL: 'O 84.5',
  MONEYLINE: 'DET ML',
  SURVIVOR: 'DET',
};

type Phase = 'upcoming' | 'live' | 'final';

function modelFor(kind: string, phase: Phase) {
  const stake = STAKES[kind];
  if (!stake) throw new Error(`no stake ${kind}`);
  const status = phase === 'upcoming' ? 'scheduled' : phase === 'live' ? 'in_progress' : 'final';
  return pickCardModel({
    stake,
    teams,
    weekGames: [{ game_id: 'g1', status, scheduled_start: game.scheduled_start }],
    liveGames: phase === 'live' ? [liveScore] : [],
    now: NOW,
  });
}

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function colorOf(element: Element | null): string {
  if (!(element instanceof HTMLElement)) throw new Error('missing element');
  // happy-dom reports `rgba(r, g, b, 1.00)`; compare the channels only.
  const match = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(element).color);
  return match ? `${match[1]}, ${match[2]}, ${match[3]}` : '';
}

describe('PickCard', () => {
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

  function render(kind: string, phase: Phase, onRemove?: () => void): void {
    act(() => {
      root.render(createElement(PickCard, { model: modelFor(kind, phase), onRemove }));
    });
  }

  for (const kind of Object.keys(STAKES)) {
    it(`${kind} upcoming: eyebrow, accent pick, matchup and kickoff, no bar`, () => {
      render(kind, 'upcoming');
      const card = host.querySelector('[data-testid="pick-card-upcoming"]');
      expect(card?.textContent).toContain(kind);
      expect(host.querySelector('[data-testid="pick-card-pick"]')?.textContent).toBe(PICKS[kind]);
      expect(colorOf(host.querySelector('[data-testid="pick-card-pick"]'))).toBe(
        rgb(theme.colors.accent),
      );
      expect(host.querySelector('[aria-label="DET @ GB"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="pick-card-status"]')?.textContent).toBe('in 1h 0m');
      expect(host.querySelector('[data-testid="pick-card-progress"]')).toBeNull();
      expect(host.textContent).not.toMatch(/stake/i);
    });

    it(`${kind} live: score and clock, progress bar`, () => {
      render(kind, 'live');
      expect(host.querySelector('[data-testid="pick-card-live"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="pick-card-status"]')?.textContent).toContain('Q2');
      expect(colorOf(host.querySelector('[data-testid="pick-card-status"]'))).toBe(
        rgb(theme.colors.flare),
      );
      expect(host.querySelector('[data-testid="pick-card-progress"]')).not.toBeNull();
    });

    it(`${kind} final: dimmed, FINAL, no bar`, () => {
      render(kind, 'final');
      expect(host.querySelector('[data-testid="pick-card-final"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="pick-card-status"]')?.textContent).toBe('FINAL');
      expect(colorOf(host.querySelector('[data-testid="pick-card-pick"]'))).toBe(
        rgb(theme.colors.textTertiary),
      );
      expect(host.querySelector('[data-testid="pick-card-progress"]')).toBeNull();
      expect(host.textContent).not.toMatch(/push/i);
    });
  }

  it('shows Remove only when a handler is passed', () => {
    const onRemove = vi.fn();
    render('SPREAD', 'upcoming', onRemove);
    const button = Array.from(host.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'Remove',
    );
    expect(button).toBeDefined();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);

    render('SPREAD', 'upcoming');
    expect(host.textContent).not.toContain('Remove');
  });
});
