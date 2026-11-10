// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecapCard } from './RecapCard';
import type { RecapCardModel } from '../lib/recapCard';

vi.mock('react-native', () => import('react-native-web'));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const EMPTY_MODEL: RecapCardModel = {
  week: 9,
  isEmpty: true,
  weekLine: null,
  bestLabel: null,
  worstLabel: null,
  seasonLine: null,
};

const POPULATED_MODEL: RecapCardModel = {
  week: 9,
  isEmpty: false,
  weekLine: '3 of 5 hit (60%)',
  bestLabel: 'B. Robinson Over 79.5 rush yds · Won',
  worstLabel: 'ATL -3.5 · Lost',
  seasonLine: '9 of 14 hit this season (64%)',
};

describe('RecapCard', () => {
  it('shows a house-voice empty state instead of a generic "no data" message', async () => {
    await act(async () => {
      root.render(<RecapCard model={EMPTY_MODEL} />);
    });
    expect(container.textContent).toContain('Nothing graded yet');
    expect(container.textContent).not.toContain('No data');
    expect(container.querySelector('[data-testid="recap-card"]')).toBeNull();
  });

  it('renders the week hit rate, best/worst picks, and season-to-date hit rate', async () => {
    await act(async () => {
      root.render(<RecapCard model={POPULATED_MODEL} />);
    });
    expect(container.querySelector('[data-testid="recap-week-line"]')?.textContent).toBe(
      '3 of 5 hit (60%)',
    );
    expect(container.querySelector('[data-testid="recap-best"]')?.textContent).toBe(
      'B. Robinson Over 79.5 rush yds · Won',
    );
    expect(container.querySelector('[data-testid="recap-worst"]')?.textContent).toBe(
      'ATL -3.5 · Lost',
    );
    expect(container.querySelector('[data-testid="recap-season-line"]')?.textContent).toBe(
      '9 of 14 hit this season (64%)',
    );
  });

  it('omits the best/worst rows when there is none to show', async () => {
    await act(async () => {
      root.render(
        <RecapCard
          model={{ ...POPULATED_MODEL, bestLabel: null, worstLabel: null }}
        />,
      );
    });
    expect(container.querySelector('[data-testid="recap-best"]')).toBeNull();
    expect(container.querySelector('[data-testid="recap-worst"]')).toBeNull();
  });

  it('falls back to a decided-free message when picks were made but nothing is decided yet', async () => {
    await act(async () => {
      root.render(<RecapCard model={{ ...POPULATED_MODEL, weekLine: null }} />);
    });
    expect(container.querySelector('[data-testid="recap-week-line"]')?.textContent).toBe(
      'Nothing decided yet this week',
    );
  });
});
