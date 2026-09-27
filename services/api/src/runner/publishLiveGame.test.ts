import { describe, expect, it } from 'vitest';
import {
  InMemoryGameCatalog,
  InMemoryGameStateStore,
  InMemoryRealtimeBus,
  realtimeGameChannel,
} from '@pivot/dispatcher';
import type { GameState } from '@pivot/shared';
import { publishLiveGame } from './publishLiveGame.js';

const GAME_ID = '33333333-3333-4333-8333-333333333333';

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_ID,
    homeTeamId: 'home',
    awayTeamId: 'away',
    possessionTeamId: 'home',
    unitOnField: 'offense',
    scoreHome: 21,
    scoreAway: 9,
    quarter: 3,
    timeRemainingSec: 412,
    yardsToOpponentEndzone: 18,
    down: 2,
    distance: 7,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

describe('publishLiveGame', () => {
  it('publishes the live-list object for an in-progress game', async () => {
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState(GAME_ID, state());
    const catalog = new InMemoryGameCatalog();
    catalog.setGame(GAME_ID, {
      homeTeamAbbreviation: 'GB',
      awayTeamAbbreviation: 'ATL',
      homeTeamName: 'Packers',
      awayTeamName: 'Falcons',
      homeTeamPrimaryColor: '#203731',
      homeTeamSecondaryColor: '#FFB612',
      awayTeamPrimaryColor: '#A71930',
      awayTeamSecondaryColor: '#000000',
    });
    const realtime = new InMemoryRealtimeBus();

    await publishLiveGame({
      gameId: GAME_ID,
      scheduledStart: '2026-09-27T17:00:00Z',
      gameState,
      catalog,
      realtime,
      now: 50,
    });

    expect(realtime.published).toEqual([
      {
        channel: realtimeGameChannel(GAME_ID),
        message: {
          id: expect.any(String),
          type: 'game_state',
          timestamp: 50,
          payload: expect.objectContaining({
            game_id: GAME_ID,
            status: 'in_progress',
            scheduled_start: '2026-09-27T17:00:00Z',
            home_team: 'GB',
            away_team: 'ATL',
            score: { home: 21, away: 9 },
            quarter: 3,
          }),
        },
      },
    ]);
  });

  it('publishes a final game_state when the play leaves the game final', async () => {
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState(
      GAME_ID,
      state({ status: 'final', possessionTeamId: null, quarter: 4, timeRemainingSec: 0 }),
    );
    const catalog = new InMemoryGameCatalog();
    catalog.setGame(GAME_ID, {
      homeTeamAbbreviation: 'GB',
      awayTeamAbbreviation: 'ATL',
      homeTeamName: 'Packers',
      awayTeamName: 'Falcons',
      homeTeamPrimaryColor: '#203731',
      homeTeamSecondaryColor: '#FFB612',
      awayTeamPrimaryColor: '#A71930',
      awayTeamSecondaryColor: '#000000',
    });
    const realtime = new InMemoryRealtimeBus();

    await publishLiveGame({
      gameId: GAME_ID,
      scheduledStart: '2026-09-27T17:00:00Z',
      gameState,
      catalog,
      realtime,
      now: 60,
    });

    expect(realtime.published).toEqual([
      {
        channel: realtimeGameChannel(GAME_ID),
        message: {
          id: expect.any(String),
          type: 'game_state',
          timestamp: 60,
          payload: expect.objectContaining({
            game_id: GAME_ID,
            status: 'final',
            scheduled_start: '2026-09-27T17:00:00Z',
            score: { home: 21, away: 9 },
            quarter: 4,
          }),
        },
      },
    ]);
  });

  it('does not publish a game that is still scheduled', async () => {
    const gameState = new InMemoryGameStateStore();
    await gameState.setGameState(GAME_ID, state({ status: 'scheduled' }));
    const realtime = new InMemoryRealtimeBus();
    await publishLiveGame({
      gameId: GAME_ID,
      scheduledStart: '2026-09-27T17:00:00Z',
      gameState,
      catalog: new InMemoryGameCatalog(),
      realtime,
    });
    expect(realtime.published).toEqual([]);
  });
});
