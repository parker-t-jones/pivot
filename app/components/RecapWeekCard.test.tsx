// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecapWeekModel } from '../lib/recapHistory';
import { theme } from '../lib/theme';
import { RECAP_LABEL_COLUMN_WIDTH, RecapWeekCard } from './RecapWeekCard';

vi.mock('react-native', () => import('react-native-web'));

// The label from Parker's Week 10 screenshot, where it ran off the card.
const LONG_LABEL = 'J. Gibbs over 120.5 rush + rec yds · Won';

const MODEL: RecapWeekModel = {
  week: 10,
  eyebrow: 'WEEK 10',
  weekLine: '1 of 2 hit (50%)',
  bestLabel: LONG_LABEL,
  worstLabel: 'DET -3.5 · Lost',
  picks: [
    { id: 'a', label: 'J. Gibbs over 120.5 rush + rec yds', resultLabel: 'Won', tone: 'won' },
    { id: 'b', label: 'DET -3.5', resultLabel: 'Lost', tone: 'lost' },
    { id: 'c', label: 'Total over 47.5', resultLabel: 'Tie', tone: 'neutral' },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(expanded: boolean, onToggle = vi.fn()): void {
  act(() => {
    root.render(<RecapWeekCard expanded={expanded} model={MODEL} onToggle={onToggle} />);
  });
}

function byTestId(id: string): HTMLElement {
  const node = host.querySelector(`[data-testid="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing ${id}`);
  return node;
}

describe('RecapWeekCard', () => {
  it('collapsed: week label and hit rate only, with a Show toggle', () => {
    const onToggle = vi.fn();
    render(false, onToggle);
    expect(host.textContent).toContain('WEEK 10');
    expect(byTestId('recap-week-line').textContent).toBe('1 of 2 hit (50%)');
    expect(host.textContent).toContain('Show');
    expect(host.querySelector('[data-testid="recap-week-body"]')).toBeNull();
    const toggle = byTestId('recap-week-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('expanded: best and worst pick, then every pick with its result', () => {
    render(true);
    expect(byTestId('recap-week-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Hide');
    expect(byTestId('recap-best-label').textContent).toBe('Best pick');
    expect(byTestId('recap-best').textContent).toBe(LONG_LABEL);
    expect(byTestId('recap-worst-label').textContent).toBe('Worst pick');
    expect(byTestId('recap-worst').textContent).toBe('DET -3.5 · Lost');
    const rows = ['a', 'b', 'c'].map((id) => byTestId(`recap-pick-${id}`).textContent);
    expect(rows).toEqual([
      'J. Gibbs over 120.5 rush + rec ydsWon',
      'DET -3.5Lost',
      'Total over 47.5Tie',
    ]);
    expect(host.textContent).not.toMatch(/push|stake/i);
  });

  // Rendered-path check for the Week 10 bug: "Best pickJ. Gibbs…" with no gap and the value
  // running past the card. The row must give the label a fixed column, put a gap after it, and let
  // the value shrink and wrap instead of keeping its one-line width.
  it('lays out label/value rows as a fixed label column and a wrapping value', () => {
    render(true);
    for (const id of ['recap-best', 'recap-worst']) {
      const row = getComputedStyle(byTestId(`${id}-row`));
      expect(row.flexDirection).toBe('row');
      expect(row.justifyContent).not.toBe('space-between');
      expect(row.getPropertyValue('column-gap') || row.getPropertyValue('gap')).toContain(
        `${theme.spacing.md}px`,
      );

      const label = getComputedStyle(byTestId(`${id}-label`));
      expect(label.width).toBe(`${RECAP_LABEL_COLUMN_WIDTH}px`);
      expect(label.flexShrink).toBe('0');

      const value = getComputedStyle(byTestId(id));
      expect(value.flexGrow).toBe('1');
      expect(value.flexShrink).toBe('1');
      expect(value.minWidth).toBe('0px');
      expect(value.whiteSpace).not.toBe('nowrap');
      expect(value.textOverflow).not.toBe('ellipsis');
    }
  });

  it('lets a long pick label wrap beside a fixed result column', () => {
    render(true);
    const row = byTestId('recap-pick-a');
    const [label, result] = Array.from(row.children) as HTMLElement[];
    if (!label || !result) throw new Error('pick row children missing');
    const labelStyle = getComputedStyle(label);
    expect(labelStyle.flexShrink).toBe('1');
    expect(labelStyle.minWidth).toBe('0px');
    expect(labelStyle.whiteSpace).not.toBe('nowrap');
    expect(getComputedStyle(result).flexShrink).toBe('0');
  });
});
