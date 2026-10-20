// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeAddPick,
  getAddPickOpen,
  openAddPick,
  resetAddPickForTests,
  subscribeAddPick,
} from '../lib/addPickDrawer';
import { AddPickDrawer } from './AddPickDrawer.web';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('./AddPickFlow', () => ({
  AddPickFlow: () => null,
}));

function Harness() {
  const open = useSyncExternalStore(subscribeAddPick, getAddPickOpen, getAddPickOpen);
  return (
    <>
      <button data-testid="trigger" onClick={() => openAddPick()} type="button">
        Add a pick
      </button>
      {open ? <AddPickDrawer /> : null}
    </>
  );
}

describe('add a pick drawer', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    resetAddPickForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetAddPickForTests();
  });

  function trigger(): HTMLButtonElement {
    const button = host.querySelector('[data-testid="trigger"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing trigger');
    return button;
  }

  function openFromTrigger(): void {
    const button = trigger();
    button.focus();
    act(() => {
      button.click();
    });
  }

  it('moves focus into the drawer and returns it on Escape, close, and the backdrop', () => {
    openFromTrigger();
    const close = document.querySelector('[data-testid="add-pick-close"]');
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(close);
    expect((close as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="add-pick-close"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());

    openFromTrigger();
    act(() => {
      document
        .querySelector('[data-testid="add-pick-close"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.activeElement).toBe(trigger());

    openFromTrigger();
    act(() => {
      document
        .querySelector('[data-testid="add-pick-backdrop"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="add-pick-drawer"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(getAddPickOpen()).toBe(false);
    closeAddPick();
  });
});
