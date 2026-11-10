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

function modelFor(kind: string, phase: Phase, finalScore?: { home: number; away: number }) {
  const stake = STAKES[kind];
  if (!stake) throw new Error(`no stake ${kind}`);
  const status = phase === 'upcoming' ? 'scheduled' : phase === 'live' ? 'in_progress' : 'final';
  return pickCardModel({
    stake,
    teams,
    weekGames: [
      {
        game_id: 'g1',
        status,
        scheduled_start: game.scheduled_start,
        final_score: finalScore ?? null,
      },
    ],
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

  function render(kind: string, phase: Phase, finalScore?: { home: number; away: number }): void {
    act(() => {
      root.render(createElement(PickCard, { model: modelFor(kind, phase, finalScore) }));
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

  it('shows the final score, dimmed, when the schedule has it', () => {
    render('SPREAD', 'final', { home: 17, away: 24 });
    const status = host.querySelector('[data-testid="pick-card-status"]');
    expect(status?.textContent).toBe('FINAL · 24–17');
    expect(colorOf(status)).toBe(rgb(theme.colors.textTertiary));
  });

  it('has no Remove button or red text; removal is the phone swipe', () => {
    for (const phase of ['upcoming', 'live', 'final'] as const) {
      render('SPREAD', phase);
      expect(host.textContent).not.toContain('Remove');
      const red = Array.from(host.querySelectorAll('*')).filter(
        (node) => colorOf(node) === rgb(theme.colors.danger),
      );
      expect(red).toEqual([]);
    }
  });

  function renderStake(stake: PickCardStake, live: boolean): void {
    act(() => {
      root.render(
        createElement(PickCard, {
          model: pickCardModel({
            stake,
            teams,
            weekGames: [
              {
                game_id: 'g1',
                status: live ? 'in_progress' : 'scheduled',
                scheduled_start: game.scheduled_start,
              },
            ],
            liveGames: live ? [liveScore] : [],
            now: NOW,
          }),
        }),
      );
    });
  }

  const liveGame = { ...game, status: 'in_progress' };
  const prop: PickCardStake = {
    id: 'p1',
    game_id: 'g1',
    subject: { type: 'PLAYER', teamId: 'det' },
    condition: { type: 'STAT_OVER', stat: 'REC_YDS', line: 60.5 },
    label: 'S. LaPorta over 60.5 rec yds',
    progress: { status: 'live', current: 42, line: 60.5, needed: 19 },
    game: liveGame,
  };

  it('shows a player prop with its label and live progress, and no score bar', () => {
    renderStake(prop, true);
    expect(host.textContent).toContain('PLAYER PROP');
    expect(host.querySelector('[data-testid="pick-card-pick"]')?.textContent).toBe(
      'S. LaPorta over 60.5 rec yds',
    );
    expect(host.querySelector('[data-testid="pick-card-detail"]')?.textContent).toBe(
      '42 rec yds · 19 to go',
    );
    expect(host.querySelector('[data-testid="pick-card-progress"]')).toBeNull();
  });

  it('uses the progress line, not the full-game bar, for a half spread', () => {
    renderStake(
      {
        game_id: 'g1',
        subject: { type: 'TEAM', teamId: 'det' },
        condition: { type: 'SPREAD', line: -3.5, segment: 'H1' },
        label: 'DET 1H \u22123.5',
        progress: { status: 'live', current: 3.5 },
        game: liveGame,
      },
      true,
    );
    expect(host.textContent).toContain('DET 1H \u22123.5');
    expect(host.querySelector('[data-testid="pick-card-detail"]')?.textContent).toBe(
      'Covering by 3.5',
    );
    expect(host.querySelector('[data-testid="pick-card-progress"]')).toBeNull();
  });

  it('lists every parlay leg with its state under the parlay summary', () => {
    const later = {
      ...game,
      game_id: 'g2',
      scheduled_start: '2026-11-09T01:20:00.000Z',
      home_team_id: 'kc',
      away_team_id: 'buf',
      home_team: 'KC',
      away_team: 'BUF',
    };
    renderStake(
      {
        id: 'slip-1',
        game_id: 'g1',
        subject: { type: 'SLIP' },
        condition: { type: 'PARLAY' },
        label: '2-leg parlay',
        game: liveGame,
        summary: { status: 'live', legs: 2, hit: 0, alive: 2, lost: 0, refunded: 0 },
        legs: [
          {
            id: 'leg-b',
            game_id: 'g2',
            subject: { type: 'TEAM', teamId: 'kc' },
            condition: { type: 'MONEYLINE' },
            label: 'KC ML',
            progress: { status: 'pending' },
            game: later,
          },
          { ...prop, id: 'leg-a' },
        ],
      },
      true,
    );
    expect(host.textContent).toContain('PARLAY');
    expect(host.querySelector('[data-testid="pick-card-pick"]')?.textContent).toBe('2-leg parlay');
    expect(host.querySelector('[data-testid="pick-card-detail"]')?.textContent).toBe(
      '0 of 2 legs hit · 2 still open',
    );
    const legs = Array.from(host.querySelectorAll('[data-testid="pick-card-leg"]')).map(
      (leg) => leg.textContent,
    );
    // Kickoff order: the live leg first.
    expect(legs[0]).toContain('LEG 1');
    expect(legs[0]).toContain('Live');
    expect(legs[0]).toContain('S. LaPorta over 60.5 rec yds');
    expect(legs[0]).toContain('42 rec yds · 19 to go');
    expect(legs[1]).toContain('KC ML');
    expect(legs[1]).toContain('BUF @ KC');
    expect(host.textContent?.toLowerCase()).not.toContain('push');
  });

  function bgOf(element: Element | null): string {
    if (!(element instanceof HTMLElement)) throw new Error('missing element');
    const match = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(element).backgroundColor);
    return match ? `${match[1]}, ${match[2]}, ${match[3]}` : '';
  }

  describe('hit state', () => {
    const hitProp: PickCardStake = {
      ...prop,
      progress: { status: 'hit', current: 70, line: 60.5, needed: 0 },
    };

    it('a live prop shows an accent bar and no hit styling', () => {
      renderStake(prop, true);
      expect(host.querySelector('[data-testid="pick-card-bar"]')).not.toBeNull();
      const fill = host.querySelector('[data-testid="pick-card-bar-fill"]');
      expect(bgOf(fill)).toBe(rgb(theme.colors.accent));
      expect(host.querySelector('[data-testid="pick-card-bar-fill-hit"]')).toBeNull();
      expect(colorOf(host.querySelector('[data-testid="pick-card-detail"]'))).toBe(
        rgb(theme.colors.textSecondary),
      );
    });

    it('a hit prop shows a success bar and a hit label that is not color-only', () => {
      renderStake(hitProp, true);
      const fill = host.querySelector('[data-testid="pick-card-bar-fill-hit"]');
      expect(fill).not.toBeNull();
      expect(bgOf(fill)).toBe(rgb(theme.colors.success));
      const detail = host.querySelector('[data-testid="pick-card-detail"]');
      expect(detail?.textContent).toBe('Hit · 70 rec yds');
      expect(colorOf(detail)).toBe(rgb(theme.colors.success));
      expect(host.querySelector('[data-testid="pick-card-bar"]')?.getAttribute('aria-label')).toBe(
        '70 of 60.5',
      );
    });

    it('an upcoming prop shows no bar', () => {
      renderStake({ ...prop, progress: { status: 'pending' }, game }, false);
      expect(host.querySelector('[data-testid="pick-card-bar"]')).toBeNull();
    });

    it('a final prop that won is dimmed with no bar and no success styling', () => {
      act(() => {
        root.render(
          createElement(PickCard, {
            model: pickCardModel({
              stake: { ...prop, progress: { status: 'won', current: 70, line: 60.5, needed: 0 } },
              teams,
              weekGames: [
                { game_id: 'g1', status: 'final', scheduled_start: game.scheduled_start },
              ],
              liveGames: [],
              now: NOW,
            }),
          }),
        );
      });
      expect(host.querySelector('[data-testid="pick-card-final"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="pick-card-bar"]')).toBeNull();
      expect(colorOf(host.querySelector('[data-testid="pick-card-detail"]'))).toBe(
        rgb(theme.colors.textTertiary),
      );
    });
  });
});
