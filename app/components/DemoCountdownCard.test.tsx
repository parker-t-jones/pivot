// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoCountdownCard } from './DemoCountdownCard';

vi.mock('react-native', () => import('react-native-web'));

let container: HTMLDivElement;
let root: Root;

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

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

describe('DemoCountdownCard', () => {
  it('shows the eyebrow, a mono m:ss countdown, the promise and both badges', async () => {
    await render(<DemoCountdownCard secondsLeft={10} />);
    expect(container.textContent).toContain('DEMO · KICKOFF IN');
    expect(byId('demo-countdown')?.textContent).toBe('0:10');
    expect(container.textContent).toContain('Pivot is watching for your picks');
    expect(container.textContent).toContain('HBR');
    expect(container.textContent).toContain('CMT');
  });

  it('reads 0:01 on the last second', async () => {
    await render(<DemoCountdownCard secondsLeft={1} />);
    expect(byId('demo-countdown')?.textContent).toBe('0:01');
  });

  it('never shows a negative countdown', async () => {
    await render(<DemoCountdownCard secondsLeft={-3} />);
    expect(byId('demo-countdown')?.textContent).toBe('0:00');
  });
});
