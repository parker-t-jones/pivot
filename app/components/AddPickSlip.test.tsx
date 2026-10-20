// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddPickSlip } from './AddPickSlip';

vi.mock('react-native', () => import('react-native-web'));

function notNegative(value: string): boolean {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) || parsed >= 0;
}

describe('add pick slip edge', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.width = '320px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the card-edge perforation inside the slip with no negative margins', () => {
    act(() => {
      root.render(
        <AddPickSlip
          game={{
            away: 'WAS',
            home: 'SF',
            detail: 'Monday 8:15 PM · Prime Video nationwide',
          }}
          pick={null}
          pickLabel="PICK"
          typeLabel="Spread"
        />,
      );
    });

    const slip = host.querySelector('[data-testid="add-pick-slip"]');
    const perforation = host.querySelector('[data-testid="slip-perforation-card"]');
    if (!(slip instanceof HTMLElement) || !(perforation instanceof HTMLElement)) {
      throw new Error('slip or perforation missing');
    }

    const perforationStyle = getComputedStyle(perforation);
    expect(notNegative(perforationStyle.marginLeft)).toBe(true);
    expect(notNegative(perforationStyle.marginRight)).toBe(true);
    expect(perforationStyle.overflowX === 'hidden' || perforationStyle.overflow === 'hidden').toBe(
      true,
    );

    for (const node of Array.from(perforation.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(node);
      expect(notNegative(style.marginLeft)).toBe(true);
      expect(notNegative(style.marginRight)).toBe(true);
      expect(notNegative(style.left)).toBe(true);
      expect(notNegative(style.right)).toBe(true);
    }

    expect(perforationStyle.width).toBe('100%');
    expect(getComputedStyle(slip).overflow).not.toBe('hidden');
    expect(getComputedStyle(slip).overflowX).not.toBe('hidden');
    expect(slip.scrollWidth).toBeLessThanOrEqual(slip.clientWidth + 1);

    const slipBox = slip.getBoundingClientRect();
    const edgeBox = perforation.getBoundingClientRect();
    if (slipBox.width > 0) {
      expect(edgeBox.left).toBeGreaterThanOrEqual(slipBox.left - 0.5);
      expect(edgeBox.right).toBeLessThanOrEqual(slipBox.right + 0.5);
    }
  });
});
