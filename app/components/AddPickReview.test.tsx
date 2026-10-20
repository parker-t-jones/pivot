// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddPickReview } from './AddPickReview';

vi.mock('react-native', () => import('react-native-web'));

describe('add a pick review', () => {
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

  it('shows the readout and the free-bet note without a second pick line', () => {
    act(() => {
      root.render(
        <AddPickReview
          error={null}
          note="Uses 1 of your 2 free bets"
          onSubmit={vi.fn()}
          readout="Seahawks must win by 4+"
          saving={false}
        />,
      );
    });
    const review = host.querySelector('[data-testid="add-pick-review"]');
    expect(review?.textContent).toContain('Seahawks must win by 4+');
    expect(review?.textContent).toContain('Uses 1 of your 2 free bets');
    expect(review?.textContent).toContain('Add a pick');
    expect(review?.textContent).not.toContain('SEA');
    expect(review?.textContent).not.toContain('\u22123.5');
  });
});
