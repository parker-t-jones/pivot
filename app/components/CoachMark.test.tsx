// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoachMark } from './CoachMark';

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

describe('CoachMark', () => {
  it('renders the given text and calls onDismiss once when "Got it" is tapped', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(<CoachMark onDismiss={onDismiss} text="Tap here first" />);
    });
    expect(container.textContent).toContain('Tap here first');

    const button = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'Got it',
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
