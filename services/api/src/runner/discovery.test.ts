import { describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import { applyDiscovery, type DiscoveryEvent, type SeededGame } from './discovery.js';

function game(espnEventId: string, status = 'scheduled'): SeededGame {
  return {
    id: `game-${espnEventId}`,
    espnEventId,
    homeTeamId: 'home',
    awayTeamId: 'away',
    week: 4,
    status,
    abbrToUuid: new Map([
      ['H', 'home'],
      ['A', 'away'],
    ]),
  };
}

describe('discovery', () => {
  it('marks in games live and skips postponed and unknown ones', async () => {
    const events: DiscoveryEvent[] = [
      { id: 'live-1', status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS' } } },
      { id: 'post-1', status: { type: { state: 'in', name: 'STATUS_POSTPONED' } } },
      { id: 'odd-1', status: { type: { state: 'mystery', name: 'STATUS_MYSTERY' } } },
    ];
    const rows = new Map(events.map((event) => [event.id, game(event.id)]));
    const order: string[] = [];
    const started: string[] = [];
    const logs: string[] = [];
    const states = new Map<string, GameState>();

    const result = await applyDiscovery({
      events,
      now: () => 1_000,
      log: (line) => logs.push(line),
      games: {
        findByEspnId: (espnEventId) => Promise.resolve(rows.get(espnEventId) ?? null),
        setStatus: (gameId, status) => {
          order.push(`status:${gameId}:${status}`);
          const row = [...rows.values()].find((candidate) => candidate.id === gameId);
          if (row) row.status = status;
          return Promise.resolve();
        },
      },
      gameState: {
        getGameState: (gameId) => Promise.resolve(states.get(gameId) ?? null),
        setGameState: (gameId, state) => {
          order.push(`state:${gameId}`);
          states.set(gameId, state);
          return Promise.resolve();
        },
      },
      loops: {
        isRunning: () => false,
        start: (seeded) => {
          order.push(`start:${seeded.id}`);
          started.push(seeded.id);
        },
        stop: () => undefined,
      },
    });

    expect(result.live).toBe(1);
    expect(started).toEqual(['game-live-1']);
    expect(order).toEqual([
      'state:game-live-1',
      'status:game-live-1:in_progress',
      'start:game-live-1',
    ]);
    expect(states.get('game-live-1')?.status).toBe('in_progress');
    expect(
      logs.some((line) => line.includes('not live post-1') && line.includes('STATUS_POSTPONED')),
    ).toBe(true);
    expect(
      logs.some((line) => line.includes('unknown state odd-1') && line.includes('mystery')),
    ).toBe(true);
    expect(logs.at(-1)).toBe('[runner] discovery live=1');
  });

  it('seeds game state from the scoreboard score, period, and display clock', async () => {
    const event: DiscoveryEvent = {
      id: 'live-1',
      status: {
        type: { state: 'in', name: 'STATUS_IN_PROGRESS' },
        period: 2,
        displayClock: '8:41',
      },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', score: '7' },
            { homeAway: 'away', score: '3' },
          ],
        },
      ],
    };
    const states = new Map<string, GameState>();
    await applyDiscovery({
      events: [event],
      now: () => 5_000,
      games: {
        findByEspnId: () => Promise.resolve(game('live-1')),
        setStatus: () => Promise.resolve(),
      },
      gameState: {
        getGameState: (gameId) => Promise.resolve(states.get(gameId) ?? null),
        setGameState: (gameId, state) => {
          states.set(gameId, state);
          return Promise.resolve();
        },
      },
      loops: { isRunning: () => false, start: () => undefined, stop: () => undefined },
    });

    expect(states.get('game-live-1')).toMatchObject({
      scoreHome: 7,
      scoreAway: 3,
      quarter: 2,
      timeRemainingSec: 8 * 60 + 41,
      status: 'in_progress',
      updatedAt: 5_000,
    });
  });
});
