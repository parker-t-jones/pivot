// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SwipeToRemove } from './SwipeToRemove';

vi.mock('react-native', () => import('react-native-web'));

/** Drives react-native-web's responder system with mouse events from `fromX` to `toX`. */
function drag(target: Element, fromX: number, toX: number, steps = 6): void {
  const fire = (type: string, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 100,
      buttons: 1,
    });
    // happy-dom leaves pageX/pageY at 0; the responder system reads them.
    Object.defineProperty(event, 'pageX', { value: x });
    Object.defineProperty(event, 'pageY', { value: 100 });
    target.dispatchEvent(event);
  };
  act(() => {
    fire('mousedown', fromX);
    for (let i = 1; i <= steps; i += 1) {
      fire('mousemove', fromX + ((toX - fromX) * i) / steps);
    }
    fire('mouseup', toX);
  });
}

describe('SwipeToRemove', () => {
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

  /** Real timers: Animated's frame loop does not advance under fake timers. */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }

  function render(onRemove: () => void): Element {
    act(() => {
      root.render(
        createElement(SwipeToRemove, {
          accessibilityLabel: 'SPREAD, DET −3.5',
          onRemove,
          testID: 'swipe',
          children: createElement('span', { 'data-testid': 'child' }, 'DET −3.5'),
        }),
      );
    });
    const child = host.querySelector('[data-testid="child"]');
    if (!child) throw new Error('child missing');
    return child;
  }

  it('removes on a long left swipe, with no confirm and no red text', async () => {
    const onRemove = vi.fn();
    const child = render(onRemove);
    drag(child, 300, 100);
    await settle();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toMatch(/are you sure/i);
  });

  it('removes once even if the row is swiped again while sliding out', async () => {
    const onRemove = vi.fn();
    const child = render(onRemove);
    drag(child, 300, 100);
    drag(child, 300, 100);
    await settle();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not remove on a short drag or a right swipe', async () => {
    const onRemove = vi.fn();
    const child = render(onRemove);
    drag(child, 300, 285);
    await settle();
    drag(child, 100, 300);
    await settle();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('labels the row for VoiceOver with a swipe hint', () => {
    render(vi.fn());
    const labelled = host.querySelector('[aria-label="SPREAD, DET −3.5"]');
    expect(labelled).not.toBeNull();
  });
});
