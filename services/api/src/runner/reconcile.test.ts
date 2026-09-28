import { describe, expect, it } from 'vitest';
import {
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryRealtimeBus,
  realtimeGameChannel,
} from '@pivot/dispatcher';
import type { EspnClient, EspnScoreboard, EspnScoreboardWeek } from '@pivot/ingestion';
import type { GameState } from '@pivot/shared';
import type { GameDirectory, InProgressGame } from './discovery.js';

type ScoreboardEvent = NonNullable<EspnScoreboard['events']>[number];
import { reconcileInProgress } from './reconcile.js';

function liveState(gameId: string): GameState {
  return {
    gameId,
    homeTeamId: 'home',
    awayTeamId: 'away',
    possessionTeamId: 'home',
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 0,
    quarter: 1,
    timeRemainingSec: 592,
    yardsToOpponentEndzone: 38,
    down: 2,
    distance: 2,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
  };
}

function row(id: string, espnEventId: string | null, week: number): InProgressGame {
  return {
    id,
    espnEventId,
    scheduledStart: '2026-09-27T17:00:00Z',
    seasonYear: 2026,
    seasonType: 'regular',
    week,
  };
}

function directory(
  rows: InProgressGame[],
): Pick<GameDirectory, 'listInProgress' | 'setStatus'> & { statuses: Map<string, string> } {
  const statuses = new Map(rows.map((game) => [game.id, 'in_progress']));
  return {
    statuses,
    setStatus: (gameId, status) => {
      statuses.set(gameId, status);
      return Promise.resolve();
    },
    listInProgress: () =>
      Promise.resolve(rows.filter((game) => statuses.get(game.id) === 'in_progress')),
  };
}

type Board = ScoreboardEvent[] | 'fail';

/** Keyed `current` or `<week number>`. Records every fetch as the same key. */
function scoreboard(boards: Record<string, Board>): Pick<EspnClient, 'getScoreboard'> & {
  fetches: string[];
} {
  const fetches: string[] = [];
  return {
    fetches,
    getScoreboard: (week?: EspnScoreboardWeek) => {
      const key = week === undefined ? 'current' : String(week.week);
      fetches.push(key);
      const board = boards[key] ?? [];
      return Promise.resolve(
        board === 'fail'
          ? { ok: false as const, kind: 'http_error' as const, reason: 'ESPN request failed: 503' }
          : { ok: true as const, data: { events: board } },
      );
    },
  };
}

const FINAL: ScoreboardEvent['status'] = {
  type: { state: 'post', name: 'STATUS_FINAL', completed: true },
};
const LIVE: ScoreboardEvent['status'] = {
  type: { state: 'in', name: 'STATUS_IN_PROGRESS' },
};

describe('reconcileInProgress', () => {
  it('finalizes a game a stopped run left in_progress and publishes the final game_state', async () => {
    const games = directory([row('g-stale', '401', 3)]);
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState('g-stale', liveState('g-stale'));
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    const result = await reconcileInProgress({
      scoreboard: scoreboard({ current: [{ id: '401', status: FINAL }] }),
      games,
      gameState,
      catalog: new InMemoryGameCatalog(),
      realtime,
      now: () => 5_000,
      log: (line) => logs.push(line),
    });

    expect(result.finalized).toBe(1);
    expect(games.statuses.get('g-stale')).toBe('final');
    expect(await gameState.getGameState('g-stale')).toEqual({
      ...liveState('g-stale'),
      status: 'final',
      updatedAt: 5_000,
    });
    expect(realtime.published).toEqual([
      {
        channel: realtimeGameChannel('g-stale'),
        message: expect.objectContaining({
          type: 'game_state',
          payload: expect.objectContaining({
            game_id: 'g-stale',
            status: 'final',
            scheduled_start: '2026-09-27T17:00:00Z',
          }),
        }),
      },
    ]);
    expect(logs).toEqual([
      '[runner] reconcile: finalized g-stale (ESPN 401) from the current scoreboard',
      '[runner] reconcile in_progress=1 finalized=1',
    ]);
  });

  it("finalizes week-2 games from their own week's scoreboard, fetched once", async () => {
    const games = directory([row('g-wk2-a', '201', 2), row('g-wk2-b', '202', 2)]);
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState('g-wk2-a', liveState('g-wk2-a'));
    const realtime = new InMemoryRealtimeBus();
    const board = scoreboard({
      current: [{ id: '401', status: FINAL }],
      '2': [
        { id: '201', status: FINAL },
        { id: '202', status: FINAL },
      ],
    });
    const logs: string[] = [];

    const result = await reconcileInProgress({
      scoreboard: board,
      games,
      gameState,
      catalog: new InMemoryGameCatalog(),
      realtime,
      log: (line) => logs.push(line),
    });

    expect(result.finalized).toBe(2);
    expect(board.fetches).toEqual(['current', '2']);
    expect(games.statuses.get('g-wk2-a')).toBe('final');
    expect(games.statuses.get('g-wk2-b')).toBe('final');
    expect((await gameState.getGameState('g-wk2-a'))?.status).toBe('final');
    expect(realtime.published.map((entry) => entry.channel)).toEqual([
      realtimeGameChannel('g-wk2-a'),
    ]);
    expect(logs).toEqual([
      '[runner] reconcile: finalized g-wk2-a (ESPN 201) from the 2026 regular week 2 scoreboard',
      '[runner] reconcile: finalized g-wk2-b (ESPN 202) from the 2026 regular week 2 scoreboard (no game_state to publish)',
      '[runner] reconcile in_progress=2 finalized=2',
    ]);
  });

  it('logs and leaves alone a game neither scoreboard has, or whose week fetch fails', async () => {
    const games = directory([
      row('g-missing', '299', 2),
      row('g-fetchfail', '101', 1),
      row('g-unseeded', null, 2),
    ]);
    const board = scoreboard({ current: [], '2': [{ id: '201', status: FINAL }], '1': 'fail' });
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    const result = await reconcileInProgress({
      scoreboard: board,
      games,
      gameState: new InMemoryGameStateStore(),
      catalog: new InMemoryGameCatalog(),
      realtime,
      log: (line) => logs.push(line),
    });

    expect(result.finalized).toBe(0);
    expect([...games.statuses.values()]).toEqual(['in_progress', 'in_progress', 'in_progress']);
    expect(realtime.published).toEqual([]);
    expect(board.fetches).toEqual(['current', '2', '1']);
    expect(logs).toEqual([
      '[runner] reconcile: g-missing (ESPN 299) is not on the current or 2026 regular week 2 scoreboard; left in_progress',
      '[runner] reconcile: 2026 regular week 1 scoreboard failed: ESPN request failed: 503',
      '[runner] reconcile: g-fetchfail (ESPN 101) is not on the current or 2026 regular week 1 scoreboard; left in_progress',
      '[runner] reconcile: g-unseeded (ESPN none) has no ESPN id; left in_progress',
      '[runner] reconcile in_progress=3 finalized=0',
    ]);
  });

  it('leaves a game ESPN still shows live on the current scoreboard to discovery', async () => {
    const games = directory([row('g-live', '403', 3)]);
    const board = scoreboard({ current: [{ id: '403', status: LIVE }] });
    const logs: string[] = [];

    await reconcileInProgress({
      scoreboard: board,
      games,
      gameState: new InMemoryGameStateStore(),
      catalog: new InMemoryGameCatalog(),
      realtime: new InMemoryRealtimeBus(),
      log: (line) => logs.push(line),
    });

    expect(games.statuses.get('g-live')).toBe('in_progress');
    expect(board.fetches).toEqual(['current']);
    expect(logs[0]).toBe(
      '[runner] reconcile: g-live (ESPN 403) is live on the current scoreboard; left to discovery',
    );
  });
});
