// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Linking } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_WATCH_HINT_MS, DemoHomeLive } from './DemoHomeLive';
import {
  DEMO_ACTIVE_AT_MS,
  DEMO_CLOSING_AT_MS,
  DEMO_HIT_AT_MS,
  DEMO_WATCH_HINT,
  DEMO_WATCH_LABEL,
  demoLiveStakeCards,
  demoSnapshotAtElapsed,
} from '../lib/demoGameDay';
import { pickCardModel } from '../lib/pickCard';

vi.mock('react-native', () => import('react-native-web'));

// The real card reads font names from `lib/fonts`, which loads expo-font (needs `__DEV__`).
vi.mock('../lib/fonts', () => ({
  fonts: {
    teamNickname: 'sans-serif',
    sansBold: 'sans-serif',
    sansSemiBold: 'sans-serif',
    monoBold: 'monospace',
    monoSemiBold: 'monospace',
    monoMedium: 'monospace',
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

function viewAt(elapsed: number) {
  const snapshot = demoSnapshotAtElapsed(elapsed);
  const live = snapshot.live;
  if (!live) throw new Error('expected a live game');
  return (
    <DemoHomeLive
      games={demoLiveStakeCards(live)}
      picks={snapshot.picks.map((pick) => ({
        id: pick.id,
        model: pickCardModel({
          stake: pick,
          teams: [],
          weekGames: null,
          liveGames: [live],
          now: new Date('2026-11-15T19:00:00.000Z'),
        }),
      }))}
    />
  );
}

async function renderAt(elapsed: number) {
  await act(async () => {
    root.render(viewAt(elapsed));
  });
}

function watchButton(): Element | undefined {
  return Array.from(container.querySelectorAll('[role="button"]')).find((el) =>
    (el.textContent ?? '').includes(DEMO_WATCH_LABEL),
  );
}

describe('DemoHomeLive', () => {
  it('lays out Home on a live day: eyebrow, title, the NOW ACTIVE hero, then YOUR PICKS', async () => {
    await renderAt(DEMO_ACTIVE_AT_MS);
    expect(byId('demo-home-live-eyebrow')?.textContent).toBe('● LIVE · 1 GAME');
    expect(container.textContent).toContain('Home');
    const hero = byId('demo-home-live-hero');
    expect(hero?.textContent).toContain('Your live games');
    expect(hero?.textContent).toContain('NOW ACTIVE');
    const picks = byId('demo-home-live-picks');
    expect(picks?.textContent).toContain('YOUR PICKS · 2');
    expect(picks?.querySelectorAll('[data-testid="pick-card-live"]')).toHaveLength(2);
    // The hero comes before the picks in the page.
    expect(
      hero && picks && hero.compareDocumentPosition(picks) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws the hero with the demo teams, score, gauge, on-field chip and clock line', async () => {
    await renderAt(DEMO_ACTIVE_AT_MS);
    const hero = byId('demo-home-live-hero');
    // CMT has the ball, so it is on the left, field-aligned, with its score beside it.
    expect(byId('live-score-left')?.textContent).toBe('CMT10');
    expect(byId('live-score-right')?.textContent).toBe('7HBR');
    expect(hero?.textContent).toContain('CMT 25');
    expect(hero?.textContent).toContain('Q3 · 7:40 · 1st & 10');
    expect(hero?.textContent).toContain('R. Vance WR · ON FIELD');
    // The numbered field gauge's tick labels.
    expect(hero?.textContent).toContain('50');
    expect(hero?.textContent).not.toContain('RED ZONE');
  });

  it('advances the gauge, clock and score with each beat', async () => {
    await renderAt(DEMO_CLOSING_AT_MS);
    let hero = byId('demo-home-live-hero');
    expect(hero?.textContent).toContain('HBR 34');
    expect(hero?.textContent).toContain('Q3 · 5:55 · 2nd & 7');

    await renderAt(DEMO_HIT_AT_MS);
    hero = byId('demo-home-live-hero');
    expect(byId('live-score-left')?.textContent).toBe('CMT17');
    expect(hero?.textContent).toContain('HBR 2');
    expect(hero?.textContent).toContain('Q3 · 4:12');
    expect(hero?.textContent).toContain('RED ZONE');
  });

  it('shows the same hit state on the prop card as the real Watchlist, under the hero', async () => {
    await renderAt(DEMO_CLOSING_AT_MS);
    expect(byId('pick-card-bar-fill-hit')).toBeNull();
    await renderAt(DEMO_HIT_AT_MS);
    expect(byId('pick-card-bar-fill-hit')).not.toBeNull();
    expect(container.textContent).toContain('Hit · 70 rec yds');
  });

  it('draws the Watch button in the real style, with the demo label and no service name', async () => {
    await renderAt(DEMO_ACTIVE_AT_MS);
    const button = watchButton();
    expect(button).toBeDefined();
    expect(button?.textContent).toBe('Watch on your service');
    expect(byId('demo-watch-hint')).toBeNull();
  });

  it('shows only the demo hint when Watch is tapped: no link, no fetch, no window.open', async () => {
    const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const canOpenURL = vi.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderAt(DEMO_ACTIVE_AT_MS);

    await act(async () => {
      watchButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(byId('demo-watch-hint')?.textContent).toBe(DEMO_WATCH_HINT);
    expect(openURL).not.toHaveBeenCalled();
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('hides the hint after a few seconds, and a second tap restarts it', async () => {
    await renderAt(DEMO_ACTIVE_AT_MS);
    const tap = async () => {
      await act(async () => {
        watchButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };
    await tap();
    expect(byId('demo-watch-hint')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(DEMO_WATCH_HINT_MS - 500);
    });
    await tap();
    await act(async () => {
      vi.advanceTimersByTime(DEMO_WATCH_HINT_MS - 500);
    });
    expect(byId('demo-watch-hint')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(byId('demo-watch-hint')).toBeNull();
  });

  it('keeps the whole view free of real teams, services, "stake" and betting words', async () => {
    const seen: string[] = [];
    for (const elapsed of [DEMO_ACTIVE_AT_MS, DEMO_CLOSING_AT_MS, DEMO_HIT_AT_MS]) {
      await renderAt(elapsed);
      seen.push(container.textContent ?? '');
    }
    const text = seen.join(' ');
    expect(text).not.toMatch(/\b(SEA|DAL|KC|DET|BUF|PHI)\b/);
    expect(text).not.toMatch(/youtube|hulu|fubo|sling|directv|espn|peacock|sunday ticket/i);
    expect(text).not.toMatch(/stake/i);
    expect(text).not.toMatch(/\b(odds|bet|bets|wager|edge)\b/i);
    expect(text).toContain('CMT');
    expect(text).toContain('HBR');
  });
});
