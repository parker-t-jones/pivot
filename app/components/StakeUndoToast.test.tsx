// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindStakeUndoCommit,
  getStakeUndoState,
  hideStake,
  resetStakeUndoForTests,
} from '../lib/stakeUndoStore';
import { StakeUndoToast } from './StakeUndoToast';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

/** The native toast (iPhone). Desktop's portal version is covered in WatchlistDesktop.web.test. */
describe('StakeUndoToast (native)', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    resetStakeUndoForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(createElement(StakeUndoToast)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetStakeUndoForTests();
  });

  it('renders nothing until a pick is removed', () => {
    expect(host.querySelector('[data-testid="stake-undo-toast"]')).toBeNull();
  });

  it('shows Removed with Undo, and Undo brings the pick back without a DELETE', () => {
    const commit = vi.fn();
    bindStakeUndoCommit(commit);
    act(() => hideStake('s1'));
    expect(host.textContent).toContain('Removed');
    const undo = Array.from(host.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'Undo',
    );
    act(() => {
      undo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getStakeUndoState().hiddenIds).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="stake-undo-toast"]')).toBeNull();
  });
});
