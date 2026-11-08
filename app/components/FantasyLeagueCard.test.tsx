// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetLeagueExpansionForTests,
  useLeagueExpansion,
  type FantasyLeagueCardModel,
} from '../lib/fantasyLeagueCard';
import { FantasyLeagueCard } from './FantasyLeagueCard';

vi.mock('react-native', () => import('react-native-web'));

const MODEL: FantasyLeagueCardModel = {
  leagueId: 'l1',
  eyebrow: 'FANTASY · SLEEPER',
  name: 'Dynasty Bros',
  summary: '9 starters · 2 live now',
};

/** The card wired to the real session memory, the way the Watchlist uses it. */
function Harness({
  onSeeFullLineup,
  children,
}: {
  onSeeFullLineup: () => void;
  children: ReactNode;
}) {
  const expansion = useLeagueExpansion();
  return createElement(FantasyLeagueCard, {
    expanded: expansion.isExpanded(MODEL.leagueId),
    model: MODEL,
    onSeeFullLineup,
    onToggle: () => expansion.toggle(MODEL.leagueId),
    children,
  });
}

function click(node: Element | null | undefined): void {
  if (!node) throw new Error('missing node');
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('FantasyLeagueCard', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    resetLeagueExpansionForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(onSeeFullLineup = vi.fn()): void {
    act(() => {
      root.render(
        createElement(Harness, {
          onSeeFullLineup,
          children: createElement('span', { 'data-testid': 'lineup-row' }, 'Amon-Ra St. Brown'),
        }),
      );
    });
  }

  it('starts collapsed: eyebrow, name, and summary, with no lineup rows', () => {
    render();
    expect(host.textContent).toContain('FANTASY · SLEEPER');
    expect(host.textContent).toContain('Dynasty Bros');
    expect(host.querySelector('[data-testid="fantasy-league-card-summary"]')?.textContent).toBe(
      '9 starters · 2 live now',
    );
    expect(host.querySelector('[data-testid="lineup-row"]')).toBeNull();
    expect(host.textContent).not.toContain('See full lineup');
  });

  it('expands in place on tap, and collapses again', () => {
    render();
    const toggle = host.querySelector('[data-testid="fantasy-league-card-toggle"]');
    click(toggle);
    expect(host.querySelector('[data-testid="lineup-row"]')).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(host.querySelector('[data-testid="lineup-row"]')).toBeNull();
  });

  it('remembers the expanded league across a remount (tab switch)', () => {
    render();
    click(host.querySelector('[data-testid="fantasy-league-card-toggle"]'));
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(host.querySelector('[data-testid="lineup-row"]')).not.toBeNull();
  });

  it('"See full lineup" hands off to the Fantasy tab', () => {
    const onSeeFullLineup = vi.fn();
    render(onSeeFullLineup);
    click(host.querySelector('[data-testid="fantasy-league-card-toggle"]'));
    const link = Array.from(host.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'See full lineup',
    );
    click(link);
    expect(onSeeFullLineup).toHaveBeenCalledTimes(1);
  });
});
