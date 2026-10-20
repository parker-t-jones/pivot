// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddPickTypeStep } from './AddPickTypeStep';

vi.mock('react-native', () => import('react-native-web'));

describe('add a pick type step', () => {
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

  function renderStep(
    allowance: { isPro: boolean; freeLeft: number | null } | null,
    onChoose: (kind: string) => void,
    onUpgrade: () => void,
  ): void {
    act(() => {
      root.render(
        <AddPickTypeStep allowance={allowance} onChoose={onChoose} onUpgrade={onUpgrade} />,
      );
    });
  }

  it('shows the free-bet count and every explainer when bets remain', () => {
    const onChoose = vi.fn();
    renderStep({ isPro: false, freeLeft: 2 }, onChoose, vi.fn());
    expect(host.textContent).toContain('2 free bets left this week');
    expect(host.textContent).toContain('Pick a team to cover the line');
    expect(host.textContent).toContain("doesn't use a free bet");
    const spread = Array.from(host.querySelectorAll('[tabindex="0"]')).find((node) =>
      node.textContent?.includes('Spread'),
    );
    if (!(spread instanceof HTMLElement)) throw new Error(host.innerHTML.slice(0, 800));
    act(() => {
      spread.click();
    });
    expect(onChoose).toHaveBeenCalledWith('SPREAD');
  });

  it('disables bet types at the cap and still lets survivor through', () => {
    const onChoose = vi.fn();
    const onUpgrade = vi.fn();
    renderStep({ isPro: false, freeLeft: 0 }, onChoose, onUpgrade);
    expect(host.textContent).toContain('0 free bets left this week');
    expect(host.textContent).toContain('No free bets left · Upgrade');
    const row = (label: string) => {
      const node = Array.from(host.querySelectorAll('[tabindex="0"]')).find((item) =>
        item.textContent?.includes(label),
      );
      if (!(node instanceof HTMLElement)) throw new Error(`missing ${label}`);
      return node;
    };
    act(() => {
      row('Spread').click();
      row('Survivor').click();
    });
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith('SURVIVOR');
  });

  it('hides the count for Pro', () => {
    renderStep({ isPro: true, freeLeft: null }, vi.fn(), vi.fn());
    expect(host.textContent).not.toContain('free bets left');
    expect(host.textContent).not.toContain('No free bets left');
    expect(host.textContent).toContain('Pick the winner');
  });
});
