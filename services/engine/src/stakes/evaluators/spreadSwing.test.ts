import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { evaluateSpreadSwing } from './spreadSwing.js';

const PHI = 'PHI';
const CHI = 'CHI';
const GAME_ID = '401872963';

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

function phiMargin(margin: number, overrides: Partial<GameState> = {}): GameState {
  const scores =
    margin >= 0 ? { scoreHome: 0, scoreAway: margin } : { scoreHome: -margin, scoreAway: 0 };
  return game({ ...scores, ...overrides });
}

function stake(line: number, overrides: Partial<Stake> = {}): Stake {
  return {
    id: 'stake-phi',
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject: { type: 'TEAM', teamId: PHI },
    condition: { type: 'SPREAD', line },
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function context(state: GameState): EvaluatorContext {
  return { gameId: state.gameId, game: state, lineup };
}

describe('evaluateSpreadSwing', () => {
  it('emits nothing for a blowout against the number', () => {
    expect(evaluateSpreadSwing(stake(-3.5), context(phiMargin(24)))).toEqual([]);
    expect(evaluateSpreadSwing(stake(7), context(phiMargin(-24)))).toEqual([]);
  });

  it('fires on a push and at distance 3, and not at distance 3.5, for a favorite and an underdog', () => {
    const favorite = stake(-3.5);
    const push = evaluateSpreadSwing(favorite, context(phiMargin(3.5)));
    expect(push.map((trigger) => trigger.code)).toEqual(['SPREAD_SWING']);
    expect(push[0]?.kind).toBe('REVEAL');
    expect(push[0]?.dedupeKey).toBe('stake-phi:SPREAD_SWING');
    expect(evaluateSpreadSwing(favorite, context(phiMargin(6.5)))).toHaveLength(1);
    expect(evaluateSpreadSwing(favorite, context(phiMargin(7)))).toEqual([]);

    const dog = stake(7);
    const dogPush = evaluateSpreadSwing(dog, context(phiMargin(-7)));
    expect(dogPush.map((trigger) => trigger.code)).toEqual(['SPREAD_SWING']);
    expect(dogPush[0]?.kind).toBe('REVEAL');
    expect(evaluateSpreadSwing(dog, context(phiMargin(-4)))).toHaveLength(1);
    expect(evaluateSpreadSwing(dog, context(phiMargin(-3.5)))).toEqual([]);
  });

  it('fires in the fourth quarter and overtime, not in the third', () => {
    const favorite = stake(-3.5);
    expect(evaluateSpreadSwing(favorite, context(phiMargin(3.5, { quarter: 3 })))).toEqual([]);
    expect(evaluateSpreadSwing(favorite, context(phiMargin(3.5, { quarter: 4 })))).toHaveLength(1);
    expect(evaluateSpreadSwing(favorite, context(phiMargin(3.5, { quarter: 5 })))).toHaveLength(1);
  });

  it('returns [] for a final game', () => {
    expect(evaluateSpreadSwing(stake(-3.5), context(phiMargin(3.5, { status: 'final' })))).toEqual(
      [],
    );
  });

  it('returns [] when team ids are missing or the subject team is not playing', () => {
    expect(
      evaluateSpreadSwing(stake(-3.5), context(phiMargin(3.5, { homeTeamId: '', awayTeamId: '' }))),
    ).toEqual([]);
    expect(
      evaluateSpreadSwing(
        stake(-3.5, { subject: { type: 'TEAM', teamId: 'DAL' } }),
        context(phiMargin(3.5)),
      ),
    ).toEqual([]);
  });

  it('returns [] for another condition or game', () => {
    const live = context(phiMargin(3.5));
    expect(evaluateSpreadSwing(stake(-3.5, { condition: { type: 'SURVIVOR' } }), live)).toEqual([]);
    expect(evaluateSpreadSwing(stake(-3.5, { gameId: 'other-game' }), live)).toEqual([]);
  });

  it('keeps REVEAL leverage in [0, 1], higher closer to the number, and higher later', () => {
    const favorite = stake(-3.5);
    const onNumber = evaluateSpreadSwing(
      favorite,
      context(phiMargin(3.5, { timeRemainingSec: 0 })),
    )[0]?.leverage;
    const atWindow = evaluateSpreadSwing(
      favorite,
      context(phiMargin(6.5, { timeRemainingSec: 0 })),
    )[0]?.leverage;
    expect(onNumber).toBeGreaterThan(atWindow ?? 0);
    expect(onNumber).toBeGreaterThanOrEqual(0);
    expect(onNumber).toBeLessThanOrEqual(1);
    expect(atWindow).toBeGreaterThanOrEqual(0);
    expect(atWindow).toBeLessThanOrEqual(1);

    const early = evaluateSpreadSwing(
      favorite,
      context(phiMargin(3.5, { timeRemainingSec: 800 })),
    )[0]?.leverage;
    const late = evaluateSpreadSwing(
      favorite,
      context(phiMargin(3.5, { timeRemainingSec: 100 })),
    )[0]?.leverage;
    const ot = evaluateSpreadSwing(
      favorite,
      context(phiMargin(3.5, { quarter: 5, timeRemainingSec: 600 })),
    )[0]?.leverage;
    const q4 = evaluateSpreadSwing(
      favorite,
      context(phiMargin(3.5, { quarter: 4, timeRemainingSec: 600 })),
    )[0]?.leverage;
    expect(late).toBeGreaterThan(early ?? 0);
    expect(ot).toBeGreaterThan(q4 ?? 0);
    expect(ot).toBeLessThanOrEqual(1);
  });
});
