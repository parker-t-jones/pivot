import { describe, expect, it } from 'vitest';
import {
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryRealtimeBus,
  realtimeGameChannel,
} from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';
import type { DiscoveryEvent, GameDirectory, InProgressGame } from './discovery.js';
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

function directory(
  rows: InProgressGame[],
): Pick<GameDirectory, 'listInProgress' | 'setStatus'> & { statuses: Map<string, string> } {
  const statuses = new Map(rows.map((row) => [row.id, 'in_progress']));
  return {
    statuses,
    setStatus: (gameId, status) => {
      statuses.set(gameId, status);
      return Promise.resolve();
    },
    listInProgress: () =>
      Promise.resolve(rows.filter((row) => statuses.get(row.id) === 'in_progress')),
  };
}

const FINAL: DiscoveryEvent['status'] = {
  type: { state: 'post', name: 'STATUS_FINAL', completed: true },
};
const LIVE: DiscoveryEvent['status'] = {
  type: { state: 'in', name: 'STATUS_IN_PROGRESS' },
};

describe('reconcileInProgress', () => {
  it('finalizes a game a stopped run left in_progress and publishes the final game_state', async () => {
    const games = directory([
      { id: 'g-stale', espnEventId: '401', scheduledStart: '2026-09-27T17:00:00Z' },
    ]);
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState('g-stale', liveState('g-stale'));
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    const result = await reconcileInProgress({
      events: [{ id: '401', status: FINAL }],
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
      '[runner] reconcile: finalized g-stale (ESPN 401)',
      '[runner] reconcile in_progress=1 finalized=1',
    ]);
  });

  it('finalizes the row without publishing when no game_state is left', async () => {
    const games = directory([
      { id: 'g-expired', espnEventId: '402', scheduledStart: '2026-09-27T17:00:00Z' },
    ]);
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    await reconcileInProgress({
      events: [{ id: '402', status: FINAL }],
      games,
      gameState: new InMemoryGameStateStore(),
      catalog: new InMemoryGameCatalog(),
      realtime,
      log: (line) => logs.push(line),
    });

    expect(games.statuses.get('g-expired')).toBe('final');
    expect(realtime.published).toEqual([]);
    expect(logs[0]).toBe(
      '[runner] reconcile: finalized g-expired (ESPN 402) (no game_state to publish)',
    );
  });

  it('logs and leaves alone a game the current scoreboard no longer lists', async () => {
    const games = directory([
      { id: 'g-lastweek', espnEventId: '301', scheduledStart: '2026-09-20T17:00:00Z' },
      { id: 'g-unseeded', espnEventId: null, scheduledStart: '2026-09-20T17:00:00Z' },
    ]);
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState('g-lastweek', liveState('g-lastweek'));
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    const result = await reconcileInProgress({
      events: [{ id: '401', status: FINAL }],
      games,
      gameState,
      catalog: new InMemoryGameCatalog(),
      realtime,
      log: (line) => logs.push(line),
    });

    expect(result.finalized).toBe(0);
    expect(games.statuses.get('g-lastweek')).toBe('in_progress');
    expect(games.statuses.get('g-unseeded')).toBe('in_progress');
    expect((await gameState.getGameState('g-lastweek'))?.status).toBe('in_progress');
    expect(realtime.published).toEqual([]);
    expect(logs).toEqual([
      '[runner] reconcile: g-lastweek (ESPN 301) is not on the current scoreboard; left in_progress',
      '[runner] reconcile: g-unseeded (ESPN none) is not on the current scoreboard; left in_progress',
      '[runner] reconcile in_progress=2 finalized=0',
    ]);
  });

  it('leaves a game ESPN still shows live to discovery', async () => {
    const games = directory([
      { id: 'g-live', espnEventId: '403', scheduledStart: '2026-09-27T20:25:00Z' },
    ]);
    const realtime = new InMemoryRealtimeBus();
    const logs: string[] = [];

    await reconcileInProgress({
      events: [{ id: '403', status: LIVE }],
      games,
      gameState: new InMemoryGameStateStore(),
      catalog: new InMemoryGameCatalog(),
      realtime,
      log: (line) => logs.push(line),
    });

    expect(games.statuses.get('g-live')).toBe('in_progress');
    expect(realtime.published).toEqual([]);
    expect(logs[0]).toBe(
      '[runner] reconcile: g-live (ESPN 403) is live on the scoreboard; left to discovery',
    );
  });
});
