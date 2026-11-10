// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_HIT_AT_MS, demoSnapshotAtElapsed, type DemoLiveGame } from '../lib/demoGameDay';
import { DemoCountdownCard } from './DemoCountdownCard';
import { DemoLiveRow } from './DemoLiveRow';

vi.mock('react-native', () => import('react-native-web'));

const reduceMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/useReducedMotion', () => ({
  useReducedMotion: () => reduceMotion.value,
}));

let container: HTMLDivElement;
let root: Root;

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

function liveGame(): DemoLiveGame {
  const live = demoSnapshotAtElapsed(DEMO_HIT_AT_MS).live;
  if (!live) throw new Error('expected a live game');
  return live;
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  reduceMotion.value = false;
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

describe('DemoLiveRow', () => {
  it('shows ticker, both score lines, the pylon possession line and its children', async () => {
    await render(
      <DemoLiveRow game={liveGame()} glowing={false}>
        <span data-testid="child-pick">a pick card</span>
      </DemoLiveRow>,
    );
    expect(byId('demo-live-ticker')?.textContent).toBe('LIVE · Q3 · 4:12');
    expect(byId('demo-score-HBR')?.textContent).toContain('7');
    expect(byId('demo-score-CMT')?.textContent).toContain('17');
    expect(byId('demo-pylon-marker')).not.toBeNull();
    expect(byId('demo-possession-line')?.textContent).toBe('HBR ball · 1st & 10 · HBR 25');
    expect(byId('demo-live-row')?.contains(byId('child-pick'))).toBe(true);
  });

  it('marks the glow state only when glowing', async () => {
    await render(
      <DemoLiveRow game={liveGame()} glowing={false}>
        {null}
      </DemoLiveRow>,
    );
    expect(byId('demo-live-row')).not.toBeNull();
    expect(byId('demo-live-row-glowing')).toBeNull();
    await render(
      <DemoLiveRow game={liveGame()} glowing>
        {null}
      </DemoLiveRow>,
    );
    expect(byId('demo-live-row')).toBeNull();
    expect(byId('demo-live-row-glowing')).not.toBeNull();
  });

  it('pulses the LIVE dot, and holds it still under Reduce Motion', async () => {
    await render(
      <DemoLiveRow game={liveGame()} glowing={false}>
        {null}
      </DemoLiveRow>,
    );
    expect(byId('demo-live-dot-ring')).not.toBeNull();
    reduceMotion.value = true;
    await render(
      <DemoLiveRow game={liveGame()} glowing={false}>
        {null}
      </DemoLiveRow>,
    );
    expect(byId('demo-live-dot')).not.toBeNull();
    expect(byId('demo-live-dot-ring')).toBeNull();
  });
});

describe('DemoCountdownCard', () => {
  it('shows the eyebrow, a mono m:ss countdown, the promise and both badges', async () => {
    await render(<DemoCountdownCard secondsLeft={12} />);
    expect(container.textContent).toContain('DEMO · KICKOFF IN');
    expect(byId('demo-countdown')?.textContent).toBe('0:12');
    expect(container.textContent).toContain('Pivot is watching for your picks');
    expect(container.textContent).toContain('HBR');
    expect(container.textContent).toContain('CMT');
  });

  it('never shows a negative countdown', async () => {
    await render(<DemoCountdownCard secondsLeft={-3} />);
    expect(byId('demo-countdown')?.textContent).toBe('0:00');
  });
});
