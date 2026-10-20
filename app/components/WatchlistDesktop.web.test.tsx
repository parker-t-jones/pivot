// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STAKE_UNDO_MS } from '../lib/deferredStakeRemoval';
import { resetStakeUndoForTests } from '../lib/stakeUndoStore';
import type { ManualStake } from '../lib/stakes';
import type { WeekCardModel } from '../lib/weekCardModel';
import { StakeUndoToast } from './StakeUndoToast.web';
import { WatchlistDesktop } from './WatchlistDesktop.web';

vi.mock('react-native', () => import('react-native-web'));

vi.mock('../lib/apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
}));

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

vi.mock('../contexts/SwitchingContext', () => ({
  useSwitching: () => ({ switchToGame: () => undefined }),
}));

vi.mock('../contexts/UpgradeSheetContext', () => ({
  useUpgradeSheet: () => ({ openUpgrade: () => undefined }),
}));

vi.mock('../contexts/GameLinksContext', () => ({
  useGameLinks: () => ({
    available: false,
    get: () => null,
    save: async () => undefined,
    remove: async () => undefined,
  }),
}));

const STAKE_NAME = 'ZZZ ML';

const stake: ManualStake = {
  id: 'stake-1',
  season: 2026,
  week: 6,
  game_id: 'game-1',
  source: 'MANUAL',
  weight: 1,
  subject: { type: 'TEAM', teamId: 'zzz' },
  condition: { type: 'MONEYLINE' },
  game: {
    scheduled_start: '2026-10-20T00:00:00.000Z',
    status: 'scheduled',
    home_team_id: 'jax',
    away_team_id: 'zzz',
    home_team: 'JAX',
    away_team: 'ZZZ',
    home_team_name: 'Jaguars',
    away_team_name: 'Zebras',
  },
};

const weekCard: WeekCardModel = {
  fantasy: { label: 'Fantasy', value: '0', accent: false, muted: false },
  opponent: { label: 'Opponent', value: 'Off', accent: false, muted: false },
  bets: { label: 'Free bets', value: '2 left', accent: true, muted: false },
  pools: { label: 'Pools', value: '0', accent: false, muted: false },
};

function press(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function removeButton(): Element {
  const button = document.querySelector('[aria-label="Remove"]');
  if (!button) throw new Error('Remove is not in the table');
  return button;
}

function undoButton(): Element {
  const button = Array.from(document.querySelectorAll('[role="button"]')).find((node) =>
    node.textContent?.includes('Undo'),
  );
  if (!button) throw new Error('Undo is not on the page');
  return button;
}

describe('desktop watchlist remove', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    resetStakeUndoForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetStakeUndoForTests();
    vi.useRealTimers();
  });

  function renderTable(onRemoveStake: (stake: ManualStake) => void, showTable = true): void {
    const table: ReactNode = showTable ? (
      <WatchlistDesktop
        benchSlots={[]}
        betPrompt={null}
        bottomInset={0}
        extras={null}
        filter="bets"
        liveGames={[]}
        now={new Date('2026-10-18T12:00:00.000Z')}
        onAddStake={() => undefined}
        onFilter={() => undefined}
        onRefresh={() => undefined}
        onRemoveStake={onRemoveStake}
        onWatchOpponent={() => undefined}
        opponentSlots={[]}
        pools={[]}
        refreshing={false}
        starterSlots={[]}
        stakes={[stake]}
        timeZone="America/New_York"
        topInset={0}
        week={6}
        weekCard={weekCard}
        weekGames={[]}
      />
    ) : null;
    act(() => {
      root.render(
        <>
          {table}
          <StakeUndoToast />
        </>,
      );
    });
  }

  it('hides the row, shows Undo outside the table, and deletes only when the toast expires', () => {
    const deleteStake = vi.fn();
    renderTable(deleteStake);

    const table = document.querySelector('[data-testid="watchlist-table"]');
    expect(table?.textContent).toContain(STAKE_NAME);
    expect(table).not.toBeNull();

    act(() => {
      press(removeButton());
    });

    expect(document.querySelector('[data-testid="watchlist-table"]')).toBe(table);
    expect(table?.textContent).not.toContain(STAKE_NAME);
    const toast = document.querySelector('[data-testid="stake-undo-toast"]');
    expect(toast?.textContent).toContain('Removed');
    expect(toast?.textContent).toContain('Undo');
    const undo = undoButton() as HTMLElement;
    expect(undo.tabIndex).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(getComputedStyle(undo).minHeight)).toBeGreaterThanOrEqual(44);
    expect(toast?.parentElement).toBe(document.body);
    expect(table?.contains(toast ?? null)).toBe(false);
    expect(getComputedStyle(toast as Element).position).toBe('fixed');
    expect(deleteStake).not.toHaveBeenCalled();

    act(() => {
      press(undoButton());
    });

    expect(table?.textContent).toContain(STAKE_NAME);
    expect(document.querySelector('[data-testid="stake-undo-toast"]')).toBeNull();
    expect(deleteStake).not.toHaveBeenCalled();

    act(() => {
      press(removeButton());
    });
    expect(deleteStake).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(STAKE_UNDO_MS);
    });

    expect(deleteStake).toHaveBeenCalledTimes(1);
    expect(deleteStake).toHaveBeenCalledWith(stake);
    expect(document.querySelector('[data-testid="stake-undo-toast"]')).toBeNull();
  });

  it('keeps the undo toast and does not delete when the table unmounts', () => {
    const deleteStake = vi.fn();
    renderTable(deleteStake);
    act(() => {
      press(removeButton());
    });
    expect(document.querySelector('[data-testid="stake-undo-toast"]')).not.toBeNull();

    renderTable(deleteStake, false);

    expect(document.querySelector('[data-testid="stake-undo-toast"]')?.textContent).toContain(
      'Undo',
    );
    expect(deleteStake).not.toHaveBeenCalled();
  });
});
