import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { evaluateTotalSwing } from './totalSwing.js';

const PHI = 'PHI';
const CHI = 'CHI';
const GAME_ID = '401872963';
const LINE = 47;

const lineup: UserLineupCache = {
  userId: 'u-replay',
  week: 3,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_ID,
    homeTeamId: CHI,
    awayTeamId: PHI,
    possessionTeamId: PHI,
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 4,
    timeRemainingSec: 300,
    yardsToOpponentEndzone: 40,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

/** Points still needed is LINE − (home + away). */
function needing(pointsNeeded: number, overrides: Partial<GameState> = {}): GameState {
  return game({ scoreHome: LINE - pointsNeeded, scoreAway: 0, ...overrides });
}

function stake(
  type: 'TOTAL_OVER' | 'TOTAL_UNDER' = 'TOTAL_OVER',
  overrides: Partial<Stake> = {},
): Stake {
  return {
    id: 'stake-total',
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject: { type: 'GAME', gameId: GAME_ID },
    condition: { type, line: LINE },
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function context(state: GameState): EvaluatorContext {
  return { gameId: state.gameId, game: state, lineup };
}

describe('evaluateTotalSwing', () => {
  it('emits nothing for a blowout short of the number', () => {
    expect(evaluateTotalSwing(stake(), context(needing(20)))).toEqual([]);
    expect(evaluateTotalSwing(stake('TOTAL_UNDER'), context(needing(20)))).toEqual([]);
  });

  it('fires when 7 points are needed and not when 8 are needed', () => {
    const onWindow = evaluateTotalSwing(stake(), context(needing(7)));
    expect(onWindow.map((trigger) => trigger.code)).toEqual(['TOTAL_SWING']);
    expect(onWindow[0]?.kind).toBe('REVEAL');
    expect(onWindow[0]?.dedupeKey).toBe('stake-total:TOTAL_SWING');
    expect(evaluateTotalSwing(stake('TOTAL_UNDER'), context(needing(7)))).toHaveLength(1);
    expect(evaluateTotalSwing(stake(), context(needing(8)))).toEqual([]);
  });

  it('fires on the number and stays silent once the total is past it', () => {
    expect(evaluateTotalSwing(stake(), context(needing(0)))).toHaveLength(1);
    expect(evaluateTotalSwing(stake(), context(needing(-1)))).toEqual([]);
    expect(evaluateTotalSwing(stake(), context(needing(-8)))).toEqual([]);
    expect(evaluateTotalSwing(stake('TOTAL_UNDER'), context(needing(-1)))).toEqual([]);
  });

  it('fires in the fourth quarter and overtime, not in the third', () => {
    expect(evaluateTotalSwing(stake(), context(needing(3, { quarter: 3 })))).toEqual([]);
    expect(evaluateTotalSwing(stake(), context(needing(3, { quarter: 4 })))).toHaveLength(1);
    expect(evaluateTotalSwing(stake(), context(needing(3, { quarter: 5 })))).toHaveLength(1);
  });

  it('returns [] for a final game', () => {
    expect(evaluateTotalSwing(stake(), context(needing(0, { status: 'final' })))).toEqual([]);
  });

  it('returns [] when team ids are missing', () => {
    expect(
      evaluateTotalSwing(stake(), context(needing(0, { homeTeamId: '', awayTeamId: '' }))),
    ).toEqual([]);
  });

  it('returns [] for another condition, subject, or game', () => {
    const live = context(needing(0));
    expect(
      evaluateTotalSwing(stake('TOTAL_OVER', { condition: { type: 'SURVIVOR' } }), live),
    ).toEqual([]);
    expect(
      evaluateTotalSwing(stake('TOTAL_OVER', { subject: { type: 'TEAM', teamId: PHI } }), live),
    ).toEqual([]);
    expect(evaluateTotalSwing(stake('TOTAL_OVER', { gameId: 'other-game' }), live)).toEqual([]);
  });

  it('keeps REVEAL leverage in [0, 1], higher closer to the line, and higher later', () => {
    const onLine = evaluateTotalSwing(stake(), context(needing(0, { timeRemainingSec: 0 })))[0]
      ?.leverage;
    const atWindow = evaluateTotalSwing(stake(), context(needing(7, { timeRemainingSec: 0 })))[0]
      ?.leverage;
    expect(onLine).toBeGreaterThan(atWindow ?? 0);
    expect(onLine).toBeGreaterThanOrEqual(0);
    expect(onLine).toBeLessThanOrEqual(1);
    expect(atWindow).toBeGreaterThanOrEqual(0);
    expect(atWindow).toBeLessThanOrEqual(1);

    const early = evaluateTotalSwing(stake(), context(needing(0, { timeRemainingSec: 800 })))[0]
      ?.leverage;
    const late = evaluateTotalSwing(stake(), context(needing(0, { timeRemainingSec: 100 })))[0]
      ?.leverage;
    const ot = evaluateTotalSwing(
      stake(),
      context(needing(0, { quarter: 5, timeRemainingSec: 600 })),
    )[0]?.leverage;
    const q4 = evaluateTotalSwing(
      stake(),
      context(needing(0, { quarter: 4, timeRemainingSec: 600 })),
    )[0]?.leverage;
    expect(late).toBeGreaterThan(early ?? 0);
    expect(ot).toBeGreaterThan(q4 ?? 0);
    expect(ot).toBeLessThanOrEqual(1);
  });
});
