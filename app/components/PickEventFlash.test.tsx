// @vitest-environment happy-dom
import type { PickStatus } from '@pivot/shared/picks';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlashPick } from '../lib/pickHitFlash';
import { usePickHitFlash } from '../lib/usePickHitFlash';
import { PICK_FLASH_MS, PickEventFlash } from './PickEventFlash';

vi.mock('react-native', () => import('react-native-web'));

const reduceMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/useReducedMotion', () => ({
  useReducedMotion: () => reduceMotion.value,
}));

/** The pair the Watchlist renders: `usePickHitFlash(bets)` feeding `PickEventFlash`. */
function Harness({ picks }: { picks: readonly FlashPick[] }) {
  const { flash, dismiss } = usePickHitFlash(picks);
  return <PickEventFlash flash={flash} onDone={dismiss} />;
}

function prop(status: PickStatus, current: number): FlashPick[] {
  return [
    {
      id: 'p1',
      subject: { type: 'PLAYER' },
      condition: { type: 'STAT_OVER', stat: 'REC_YDS' },
      label: 'D. Metcalf over 68.5 rec yds',
      progress: { status, current, line: 68.5 },
    },
  ];
}

let container: HTMLDivElement;
let root: Root;
let flashMounts: number;
let observer: MutationObserver;

function flashEl(): HTMLElement | null {
  return container.querySelector('[data-testid="pick-event-flash"]');
}

function opacityOf(testId: string): string | undefined {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  return el?.style.opacity;
}

/** A focus refetch: the screen re-renders with the new `GET /picks` rows. */
async function refetch(picks: readonly FlashPick[]) {
  await act(async () => {
    root.render(<Harness picks={picks} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion.value = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flashMounts = 0;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement && node.dataset.testid === 'pick-event-flash') {
          flashMounts += 1;
        }
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
});

afterEach(() => {
  observer.disconnect();
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('PickEventFlash on the Watchlist refetch path', () => {
  it('fires exactly once when a pick goes LIVE → HIT between two refetches', async () => {
    await refetch(prop('live', 47));
    expect(flashEl()).toBeNull();

    await refetch(prop('hit', 70));
    expect(flashEl()).not.toBeNull();
    expect(container.textContent).toContain('PICK HIT · 70 REC YDS');
    expect(container.textContent).toContain('D. Metcalf over 68.5 rec yds');

    await act(async () => {
      vi.advanceTimersByTime(PICK_FLASH_MS);
    });
    expect(flashEl()).toBeNull();

    // Later refetches with the pick still hit do not replay it.
    await refetch(prop('hit', 74));
    await refetch(prop('hit', 74));
    expect(flashEl()).toBeNull();
    expect(flashMounts).toBe(1);
  });

  it('does not fire for a pick that is already HIT on the first load', async () => {
    await refetch(prop('hit', 70));
    await refetch(prop('hit', 70));
    expect(flashEl()).toBeNull();
    expect(flashMounts).toBe(0);
  });

  it('animates in from transparent with full motion', async () => {
    await refetch(prop('live', 47));
    await refetch(prop('hit', 70));
    expect(opacityOf('pick-event-flash-tag')).toBe('0');
  });

  it('with Reduce Motion, shows the glow and tag at once, holds, then removes them', async () => {
    reduceMotion.value = true;
    await refetch(prop('live', 47));
    await refetch(prop('hit', 70));
    expect(opacityOf('pick-event-flash-tag')).toBe('1');
    expect(Number(opacityOf('pick-event-flash-edge'))).toBeGreaterThan(0);
    expect(container.textContent).toContain('PICK HIT · 70 REC YDS');

    await act(async () => {
      vi.advanceTimersByTime(PICK_FLASH_MS - 1);
    });
    expect(flashEl()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(flashEl()).toBeNull();
  });

  it('never takes touches', async () => {
    await refetch(prop('live', 47));
    await refetch(prop('hit', 70));
    expect(getComputedStyle(flashEl() as HTMLElement).pointerEvents).toBe('none');
  });
});
