// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoWatchlist } from './DemoWatchlist';
import { DEMO_HIT_AT_MS, DEMO_PRE_GAME_MS, demoSnapshotAtElapsed } from '../lib/demoGameDay';
import { pickCardModel } from '../lib/pickCard';

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

function cardsAt(elapsed: number) {
  const snapshot = demoSnapshotAtElapsed(elapsed);
  const live = snapshot.live;
  if (!live) throw new Error('expected a live game');
  return snapshot.picks.map((pick) => ({
    id: pick.id,
    model: pickCardModel({
      stake: pick,
      teams: [],
      weekGames: null,
      liveGames: [live],
      now: new Date('2026-11-15T19:00:00.000Z'),
    }),
  }));
}

describe('DemoWatchlist', () => {
  it('lays out the Watchlist header, a YOUR PICKS section, and one PickCard per pick', async () => {
    await act(async () => {
      root.render(<DemoWatchlist cards={cardsAt(DEMO_PRE_GAME_MS)} />);
    });
    expect(container.textContent).toContain('Watchlist');
    expect(container.textContent).toContain('YOUR PICKS · 2');
    const section = container.querySelector('[data-testid="demo-watchlist-picks"]');
    expect(section?.querySelectorAll('[data-testid="pick-card-live"]')).toHaveLength(2);
    expect(container.textContent).not.toMatch(/stake|watch on/i);
  });

  it('shows the hit state on the prop card, the same one the real Watchlist draws', async () => {
    await act(async () => {
      root.render(<DemoWatchlist cards={cardsAt(DEMO_HIT_AT_MS)} />);
    });
    expect(container.querySelector('[data-testid="pick-card-bar-fill-hit"]')).not.toBeNull();
    expect(container.textContent).toContain('Hit · 70 rec yds');
  });
});
