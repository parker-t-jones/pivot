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
  eyebrow: 'YOUR WEEK 7 CARD',
  gameCountLabel: '1 GAME',
  fantasy: { label: 'Fantasy', value: '0', accent: false, muted: false },
  opponent: { label: 'Opponent', value: 'Off', accent: false, muted: false },
  bets: {
    label: 'Bets & props',
    value: '1',
    note: '2 free left',
    strip: 'Bets & props 1 \u00b7 2 free left',
    accent: true,
    muted: false,
  },
  pools: { label: 'Survivor pool', value: '0', accent: false, muted: false },
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
    stakes: ManualStake[] = [stake],
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
        stakes={stakes}
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

  it('shows a parlay as one row with its legs, and removes the whole parlay after Undo expires', () => {
    const leg = (id: string, label: string, status: 'live' | 'hit'): ManualStake => ({
      ...stake,
      id,
      condition: { type: 'STAT_OVER' },
      subject: { type: 'PLAYER' },
      label,
      progress: { status },
    });
    const parlay: ManualStake = {
      ...stake,
      id: 'slip-1',
      subject: { type: 'SLIP' },
      condition: { type: 'PARLAY' },
      label: '2-leg parlay',
      legs: [leg('l1', 'G. Kittle over 60.5 rec yds', 'hit'), leg('l2', 'ZZZ ML', 'live')],
      summary: { status: 'live', legs: 2, hit: 1, alive: 1, lost: 0, refunded: 0 },
    };
    const onRemove = vi.fn();
    renderTable(onRemove, true, false, [parlay]);

    const table = document.querySelector('[data-testid="watchlist-table"]');
    expect(table?.textContent).toContain('PARLAY');
    expect(table?.textContent).toContain('2-leg parlay');
    expect(table?.textContent).toContain('1 of 2 legs hit · 1 still open');
    expect(table?.textContent).toContain('G. Kittle over 60.5 rec yds (Hit)');

    act(() => {
      press(removeButton());
    });
    expect(table?.textContent).not.toContain('2-leg parlay');
    act(() => {
      press(undoButton());
    });
    expect(table?.textContent).toContain('2-leg parlay');

    act(() => {
      press(removeButton());
    });
    act(() => {
      vi.advanceTimersByTime(STAKE_UNDO_MS);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(parlay);
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
      market_confidence: 'national',
    },
  ],
  airings: [{ network: 'ESPN', market: 'national', market_confidence: 'national' }],
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

describe('desktop watchlist pick column', () => {
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

  const spread: ManualStake = {
    ...stake,
    id: 'spread-1',
    subject: { type: 'TEAM', teamId: 'jax' },
    condition: { type: 'SPREAD', line: -3.5 },
  };

  function renderPicks(status: string): void {
    const game: ScheduleGame = {
      game_id: 'game-1',
      status,
      scheduled_start: '2026-10-20T00:00:00.000Z',
      home_team: 'JAX',
      away_team: 'ZZZ',
      home_team_name: 'Jaguars',
      away_team_name: 'Zebras',
      home_team_primary_color: '#006778',
      home_team_secondary_color: '#9F792C',
      away_team_primary_color: '#000000',
      away_team_secondary_color: '#FFFFFF',
      broadcasts: [],
      airings: [],
    };
    act(() => {
      root.render(
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
          onRemoveStake={() => undefined}
          onWatchOpponent={() => undefined}
          opponentSlots={[]}
          pools={[]}
          refreshing={false}
          starterSlots={[]}
          stakes={[stake, spread]}
          timeZone="America/New_York"
          topInset={0}
          week={6}
          weekCard={weekCard}
          weekGames={[game]}
        />,
      );
    });
  }

  function channels(element: Element | undefined): string {
    if (!(element instanceof HTMLElement)) throw new Error('missing element');
    const match = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(element).color);
    return match ? `${match[1]}, ${match[2]}, ${match[3]}` : '';
  }

  it('puts the type eyebrow above the pick, and the pick in accent', () => {
    renderPicks('scheduled');
    const rows = Array.from(document.querySelectorAll('[data-testid="watchlist-row"]'));
    expect(rows[0]?.textContent).toContain('MONEYLINE');
    expect(rows[1]?.textContent).toContain('SPREAD');
    const picks = Array.from(document.querySelectorAll('[data-testid="watchlist-pick"]'));
    expect(picks.map((node) => node.textContent)).toEqual([STAKE_NAME, 'JAX −3.5']);
    expect(channels(picks[1])).toBe('245, 160, 24');
  });

  it('dims the pick on a final game', () => {
    renderPicks('final');
    const picks = Array.from(document.querySelectorAll('[data-testid="watchlist-pick"]'));
    expect(channels(picks[0])).toBe('110, 110, 120');
    expect(document.querySelector('[data-testid="watchlist-table"]')?.textContent).toContain(
      'FINAL',
    );
  });

  it('shows the free count as {n} free left in the strip', () => {
    renderPicks('scheduled');
    expect(document.body.textContent).toContain('2 free left');
    expect(document.body.textContent).toContain('Survivor pool 0');
  });
});

describe('desktop watchlist order, finals, and league cards (issue #14)', () => {
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

  function weekGame(
    id: string,
    status: string,
    kickoff: string,
    extra: Partial<ScheduleGame> = {},
  ) {
    return {
      ...liveWeekGame,
      game_id: id,
      status,
      scheduled_start: kickoff,
      home_team: 'JAX',
      away_team: 'ZZZ',
      ...extra,
    } as ScheduleGame;
  }

  function pickOn(id: string, gameId: string, kickoff: string, line: number): ManualStake {
    return {
      ...stake,
      id,
      game_id: gameId,
      subject: { type: 'TEAM', teamId: 'jax' },
      condition: { type: 'SPREAD', line },
      game: { ...(stake.game as NonNullable<ManualStake['game']>), scheduled_start: kickoff },
    };
  }

  function render(props: {
    stakes?: ManualStake[];
    pools?: ManualStake[];
    weekGames?: ScheduleGame[];
    liveGames?: LiveGame[];
    leagueCards?: {
      model: { leagueId: string; eyebrow: string; name: string; summary: string };
      starters: LineupSlot[];
    }[];
    expanded?: (leagueId: string) => boolean;
    onSeeFullLineup?: (leagueId: string) => void;
  }): void {
    act(() => {
      root.render(
        <WatchlistDesktop
          benchSlots={[]}
          betPrompt={null}
          bottomInset={0}
          extras={null}
          filter="all"
          isLeagueExpanded={props.expanded}
          leagueCards={props.leagueCards}
          liveGames={props.liveGames ?? []}
          now={new Date('2026-10-18T12:00:00.000Z')}
          onAddStake={() => undefined}
          onFilter={() => undefined}
          onRefresh={() => undefined}
          onRemoveStake={() => undefined}
          onSeeFullLineup={props.onSeeFullLineup}
          onWatchOpponent={() => undefined}
          opponentSlots={[]}
          pools={props.pools ?? []}
          refreshing={false}
          starterSlots={[]}
          stakes={props.stakes ?? []}
          timeZone="America/New_York"
          topInset={0}
          week={6}
          weekCard={weekCard}
          weekGames={props.weekGames ?? []}
        />,
      );
    });
  }

  it('lists live first, then upcoming by kickoff, then finals at the bottom', () => {
    const early = '2026-10-18T17:00:00.000Z';
    const late = '2026-10-18T20:25:00.000Z';
    const night = '2026-10-19T00:20:00.000Z';
    render({
      stakes: [
        pickOn('final', 'g-final', early, -1.5),
        pickOn('night', 'g-night', night, -2.5),
        pickOn('live', 'g-live', late, -3.5),
      ],
      pools: [{ ...pickOn('pool-late', 'g-late', late, 0), condition: { type: 'SURVIVOR' } }],
      weekGames: [
        weekGame('g-final', 'final', early, { final_score: { home: 17, away: 24 } }),
        weekGame('g-night', 'scheduled', night),
        weekGame('g-live', 'in_progress', late),
        weekGame('g-late', 'scheduled', late),
      ],
    });
    const rows = Array.from(document.querySelectorAll('[data-testid="watchlist-row"]'));
    expect(rows).toHaveLength(4);
    const picks = Array.from(document.querySelectorAll('[data-testid="watchlist-pick"]')).map(
      (node) => node.textContent,
    );
    expect(picks).toEqual(['JAX −3.5', 'JAX', 'JAX −2.5', 'JAX −1.5']);
    expect(rows[3]?.textContent).toContain('FINAL · 24–17');
  });

  it('shows one collapsed card per league in All, and the lineup table only when expanded', () => {
    const cards = [
      {
        model: {
          leagueId: 'l1',
          eyebrow: 'FANTASY · SLEEPER',
          name: 'Dynasty Bros',
          summary: '2 starters · 1 live now',
        },
        starters: [lineupSlot('p1', 'Davante', 'Adams'), lineupSlot('p2', 'Brock', 'Bowers')],
      },
      {
        model: {
          leagueId: 'l2',
          eyebrow: 'FANTASY · MANUAL',
          name: 'Office',
          summary: '1 starter',
        },
        starters: [lineupSlot('p3', 'Maxx', 'Crosby')],
      },
    ];
    const onSeeFullLineup = vi.fn();
    render({
      leagueCards: cards,
      expanded: (id) => id === 'l2',
      onSeeFullLineup,
      weekGames: [liveWeekGame],
      liveGames: [liveFeed],
    });
    expect(document.body.textContent).toContain('FANTASY · SLEEPER');
    expect(document.body.textContent).toContain('2 starters · 1 live now');
    expect(document.querySelector('[data-testid="watchlist-league-l1"]')).toBeNull();
    const table = document.querySelector('[data-testid="watchlist-league-l2"]');
    expect(table?.textContent).toContain('Maxx Crosby');
    expect(document.body.textContent).not.toContain('Davante Adams');
    const link = Array.from(document.querySelectorAll('[role="button"]')).find(
      (node) => node.textContent === 'See full lineup',
    );
    act(() => {
      if (link) press(link);
    });
    expect(onSeeFullLineup).toHaveBeenCalledWith('l2');
    expect(document.querySelector('[data-testid="watchlist-lineup"]')).toBeNull();
  });
});
