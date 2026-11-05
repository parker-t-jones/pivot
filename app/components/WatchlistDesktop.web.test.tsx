// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STAKE_UNDO_MS } from '../lib/deferredStakeRemoval';
import type { LineupSlot } from '../lib/leagues';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
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

  function renderTable(
    onRemoveStake: (stake: ManualStake) => void,
    showTable = true,
    editsLocked = false,
  ): void {
    const table: ReactNode = showTable ? (
      <WatchlistDesktop
        benchSlots={[]}
        betPrompt={null}
        bottomInset={0}
        editsLocked={editsLocked}
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
    expect(table?.textContent).toContain('Pick');
    expect(table?.textContent).not.toContain('Stake');
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

  it('keeps Remove visible when the pointer moves from the row onto the button', () => {
    renderTable(() => undefined);
    const button = removeButton() as HTMLElement;
    const row = button.closest('[data-testid="watchlist-row"]');
    if (!(row instanceof HTMLElement)) throw new Error('Remove is not inside a row');

    const heightBefore = button.getBoundingClientRect().height;
    expect(getComputedStyle(button).opacity).toBe('0');
    expect(row.getAttribute('data-hovered')).toBe('0');

    act(() => {
      row.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
      );
    });

    expect(row.getAttribute('data-hovered')).toBe('1');
    expect(getComputedStyle(button).opacity).not.toBe('0');
    expect(button.getBoundingClientRect().height).toBe(heightBefore);

    act(() => {
      button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      button.dispatchEvent(
        new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }),
      );
    });

    expect(row.getAttribute('data-hovered')).toBe('1');
    expect(getComputedStyle(button).opacity).not.toBe('0');
    expect(getComputedStyle(button).pointerEvents).not.toBe('none');
    expect(button.isConnected).toBe(true);
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

  it('hides Remove on a demo bet row', () => {
    renderTable(() => undefined, true, true);
    expect(document.body.textContent).toContain(STAKE_NAME);
    expect(document.querySelector('[aria-label="Remove"]')).toBeNull();
  });
});

function lineupSlot(
  id: string,
  first: string,
  last: string,
  slotType: LineupSlot['slot_type'] = 'starter',
  position = 'WR',
): LineupSlot {
  return {
    slot_id: id,
    slot_type: slotType,
    position_in_lineup: slotType === 'bench' ? 'BN' : position,
    is_star: false,
    player: {
      player_id: id,
      first_name: first,
      last_name: last,
      position,
      team: { teamId: 'lv', abbreviation: 'LV', name: 'Raiders' },
    },
  };
}

const liveWeekGame = {
  game_id: 'game-live',
  status: 'in_progress',
  scheduled_start: '2026-10-18T17:00:00.000Z',
  home_team: 'KC',
  away_team: 'LV',
  home_team_name: 'Chiefs',
  away_team_name: 'Raiders',
  home_team_primary_color: '#E31837',
  home_team_secondary_color: '#FFB81C',
  away_team_primary_color: '#000000',
  away_team_secondary_color: '#A5ACAF',
  broadcasts: [
    {
      service: 'espn',
      deep_link_url: 'https://example.com/watch',
      requires_subscription: false,
      user_has_subscription: true,
      typical_lag_seconds: 0,
      preferred: true,
      network: 'ESPN',
      market_confidence: 'confirmed',
    },
  ],
  airings: [{ network: 'ESPN', market: 'national', market_confidence: 'confirmed' }],
} as ScheduleGame;

const liveFeed = {
  game_id: 'game-live',
  status: 'in_progress',
  scheduled_start: '2026-10-18T17:00:00.000Z',
  home_team: 'KC',
  away_team: 'LV',
  home_team_name: 'Chiefs',
  away_team_name: 'Raiders',
  home_team_primary_color: '#E31837',
  home_team_secondary_color: '#FFB81C',
  away_team_primary_color: '#000000',
  away_team_secondary_color: '#A5ACAF',
  score: { home: 7, away: 3 },
  quarter: 2,
  time_remaining_sec: 400,
  possession_team: 'LV',
  yards_to_endzone: 40,
  down: 2,
  distance: 6,
  in_red_zone: false,
} as LiveGame;

describe('desktop watchlist opponent section', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
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
  });

  function renderSplit(opponentNote: string | null): void {
    act(() => {
      root.render(
        <WatchlistDesktop
          benchSlots={[]}
          betPrompt={null}
          bottomInset={0}
          extras={null}
          filter="all"
          liveGames={[liveFeed]}
          now={new Date('2026-10-18T18:00:00.000Z')}
          onAddStake={() => undefined}
          onFilter={() => undefined}
          onRefresh={() => undefined}
          onRemoveStake={() => undefined}
          onWatchOpponent={() => undefined}
          opponentNote={opponentNote}
          opponentSlots={[
            lineupSlot('opp-starter', 'Jordan', 'Lee', 'starter', 'WR'),
            lineupSlot('opp-bench', 'Bench', 'Guy', 'bench', 'RB'),
          ]}
          opponentTeamName="Silver Harbor"
          pools={[]}
          refreshing={false}
          showOpponent
          starterSlots={[lineupSlot('user-qb', 'Sam', 'Hart', 'starter', 'QB')]}
          stakes={[stake]}
          timeZone="America/New_York"
          topInset={0}
          week={6}
          weekCard={weekCard}
          weekGames={[liveWeekGame]}
        />,
      );
    });
  }

  it('keeps the user lineup and the opponent in separate containers', () => {
    renderSplit(null);

    const lineup = document.querySelector('[data-testid="watchlist-lineup"]');
    const opponent = document.querySelector('[data-testid="watchlist-opponent"]');
    const bets = document.querySelector('[data-testid="watchlist-table"]');
    if (!(lineup instanceof HTMLElement)) throw new Error('lineup table missing');
    if (!(opponent instanceof HTMLElement)) throw new Error('opponent section missing');
    if (!(bets instanceof HTMLElement)) throw new Error('bets table missing');

    expect(lineup.contains(opponent)).toBe(false);
    expect(opponent.contains(lineup)).toBe(false);
    expect(lineup.contains(bets)).toBe(false);
    expect(lineup.textContent).toContain('Sam Hart');
    const userRow = lineup.querySelector('[data-testid="watchlist-row"]');
    expect(userRow?.textContent?.startsWith('QB')).toBe(true);
    expect(lineup.textContent).not.toContain('Jordan Lee');
    expect(lineup.textContent).not.toContain('OPPONENT');
    expect(lineup.textContent).not.toContain('vs. Silver Harbor');
    expect(lineup.textContent).toContain('Switch');

    expect(opponent.textContent).toContain('OPPONENT');
    expect(opponent.textContent).toContain('vs. Silver Harbor');
    expect(opponent.textContent).toContain('Jordan Lee');
    expect(opponent.textContent).not.toContain('Bench Guy');
    const opponentRow = opponent.querySelector('[data-testid="watchlist-row"]');
    expect(opponentRow?.textContent?.startsWith('OPP')).toBe(true);
    expect(opponentRow?.textContent).toContain('Jordan Lee');
    expect(opponent.textContent).not.toContain('Sam Hart');
    expect(opponent.textContent).not.toContain('Switch');
    expect(opponent.querySelector('[aria-label="Remove"]')).toBeNull();

    expect(bets.textContent).toContain(STAKE_NAME);
    expect(bets.textContent).not.toContain('Jordan Lee');
    expect(bets.textContent).not.toContain('Sam Hart');

    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(lineup.compareDocumentPosition(opponent) & following).toBe(following);
    expect(opponent.compareDocumentPosition(bets) & following).toBe(following);
    const body = document.body.textContent ?? '';
    expect(body.indexOf('Sam Hart')).toBeLessThan(body.indexOf('OPPONENT'));
    expect(body.indexOf('OPPONENT')).toBeLessThan(body.indexOf('vs. Silver Harbor'));
  });

  it('renders empty opponent copy in the opponent section', () => {
    renderSplit('Syncing your matchup…');
    const lineup = document.querySelector('[data-testid="watchlist-lineup"]');
    const opponent = document.querySelector('[data-testid="watchlist-opponent"]');
    expect(lineup?.textContent).toContain('Sam Hart');
    expect(lineup?.textContent).not.toContain('Syncing your matchup…');
    expect(opponent?.textContent).toContain('OPPONENT');
    expect(opponent?.textContent).toContain('Syncing your matchup…');
    expect(opponent?.textContent).toContain('vs. Silver Harbor');

    renderSplit('No opponent this week');
    const again = document.querySelector('[data-testid="watchlist-opponent"]');
    const lineupAgain = document.querySelector('[data-testid="watchlist-lineup"]');
    expect(again?.textContent).toContain('No opponent this week');
    expect(lineupAgain?.textContent).not.toContain('No opponent this week');
  });
});
