// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { weekCardModel, type WeekCardInputs } from '../lib/weekCardModel';
import { WeekCard } from './WeekCard';

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

const openUpgrade = vi.fn();
vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade }),
}));

const base: WeekCardInputs = {
  starterCount: 9,
  opponentStatus: 'on',
  betCount: 1,
  survivorCount: 1,
  isPro: false,
  week: 9,
  gameCount: 6,
};

function buttons(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[role="button"]'));
}

describe('WeekCard', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    openUpgrade.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(inputs: Partial<WeekCardInputs> = {}, onAddStake = vi.fn()): void {
    act(() => {
      root.render(
        createElement(WeekCard, {
          model: weekCardModel({ ...base, ...inputs }),
          onAddStake,
          onOpponentToggle: () => undefined,
        }),
      );
    });
  }

  it('shows YOUR WEEK n CARD, the game count, and the four labeled cells', () => {
    render();
    const text = host.textContent ?? '';
    expect(text).toContain('YOUR WEEK 9 CARD');
    expect(text).toContain('6 GAMES');
    for (const label of ['Fantasy', 'Opponent', 'Bets & props', 'Survivor pool']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Tracking');
    expect(text).not.toMatch(/stake/i);
    expect(text).not.toContain('Markets');
  });

  it('says {n} free left for a Free user, never "of 3 free"', () => {
    render({ betCount: 1 });
    const text = host.textContent ?? '';
    expect(text).toContain('2 free left');
    expect(text).not.toMatch(/of 3/);
    expect(buttons(host).some((node) => node.textContent === 'Upgrade')).toBe(false);
  });

  it('says No free bets left at the cap and offers Upgrade', () => {
    render({ betCount: 3 });
    expect(host.textContent).toContain('No free bets left');
    const upgrade = buttons(host).find((node) => node.textContent === 'Upgrade');
    expect(upgrade).toBeDefined();
    act(() => {
      upgrade?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openUpgrade).toHaveBeenCalledTimes(1);
  });

  it('shows no free count on Pro', () => {
    render({ betCount: 5, isPro: true });
    const text = host.textContent ?? '';
    expect(text).toContain('Bets & props');
    expect(text).not.toMatch(/free/i);
    expect(text).not.toContain('Upgrade');
  });

  it('uses the card-edge perforation, then Add a pick', () => {
    const onAdd = vi.fn();
    render({}, onAdd);
    const perforation = host.querySelector('[data-testid="slip-perforation-card"]');
    expect(perforation).not.toBeNull();
    expect(host.querySelector('[data-testid="slip-perforation"]')).toBeNull();
    const add = buttons(host).find((node) => node.textContent === 'Add a pick');
    expect(add).toBeDefined();
    if (!perforation || !add) return;
    // Add a pick comes after the perforation in the document.
    expect(
      perforation.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    act(() => {
      add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows the real opponent state: Off and Sleeper only', () => {
    render({ opponentStatus: 'off' });
    expect(host.querySelector('[aria-label="Opponent, Off"]')).not.toBeNull();
    render({ opponentStatus: 'sleeper-only' });
    expect(host.textContent).toContain('Sleeper only');
    expect(host.querySelector('[aria-label^="Opponent,"]')).toBeNull();
  });

  it('hides the game count while it is unknown', () => {
    render({ gameCount: null });
    expect(host.textContent).toContain('YOUR WEEK 9 CARD');
    expect(host.textContent).not.toMatch(/GAMES?\b/);
  });
});
