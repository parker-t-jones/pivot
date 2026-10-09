import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import { evaluateStake } from './evaluateStake.js';
import { evaluateOpponentRostered } from './evaluators/opponentRostered.js';
import { evaluateOneScoreLate } from './evaluators/oneScoreLate.js';
import { evaluatePickTrailing2h } from './evaluators/pickTrailing2h.js';
import { evaluateRostered } from './evaluators/rostered.js';
import { evaluateSpreadSwing } from './evaluators/spreadSwing.js';
import { evaluateTotalSwing } from './evaluators/totalSwing.js';
import type { EvaluatorContext, Stake, StakeCondition } from './types.js';

const PHI = 'PHI';
const CHI = 'CHI';
const GAME_ID = '401872963';

const emptyLineup: UserLineupCache = {
  userId: 'u-replay',
  week: 3,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

const phiOffense: UserLineupCache = {
  userId: 'u-replay',
  week: 3,
  teamPositions: new Map([[PHI, new Set<'offense' | 'defense'>(['offense'])]]),
  playerToTeam: new Map([['phi-wr', PHI]]),
  starPlayerIds: new Set(),
  playerUnits: new Map([['phi-wr', 'offense']]),
};

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_ID,
    homeTeamId: CHI,
    awayTeamId: PHI,
    possessionTeamId: PHI,
    unitOnField: 'offense',
    scoreHome: 10,
    scoreAway: 7,
    quarter: 4,
    timeRemainingSec: 300,
    yardsToOpponentEndzone: 12,
    down: 1,
    distance: 10,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

function context(
  lineup: UserLineupCache,
  state = game(),
  opponent?: UserLineupCache,
): EvaluatorContext {
  const ctx: EvaluatorContext = { gameId: state.gameId, game: state, lineup };
  if (opponent) ctx.opponent = opponent;
  return ctx;
}

function stake(condition: StakeCondition, subject: Stake['subject']): Stake {
  return {
    id: 'stake-1',
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject,
    condition,
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-09-28T00:00:00.000Z',
  };
}

describe('evaluateStake', () => {
  const player = { type: 'PLAYER', playerId: 'phi-wr', teamId: PHI } as const;
  const team = { type: 'TEAM', teamId: PHI } as const;
  const gameSubject = { type: 'GAME', gameId: GAME_ID } as const;

  it('routes ROSTERED to the rostered evaluator', () => {
    const row = stake({ type: 'ROSTERED' }, player);
    const ctx = context(phiOffense, game({ inRedZone: false, yardsToOpponentEndzone: 55 }));
    const triggers = evaluateStake(row, ctx);
    expect(triggers).toEqual(evaluateRostered(row, ctx));
    expect(triggers.map((trigger) => trigger.code)).toEqual(['POSSESSION_START']);
  });

  it('routes OPPONENT_ROSTERED to the opponent evaluator', () => {
    const row = stake({ type: 'OPPONENT_ROSTERED' }, player);
    const ctx = context(emptyLineup, game(), phiOffense);
    const triggers = evaluateStake(row, ctx);
    expect(triggers).toEqual(evaluateOpponentRostered(row, ctx));
    expect(triggers.map((trigger) => trigger.code)).toEqual(['OPP_RED_ZONE']);
  });

  it('routes MONEYLINE to ONE_SCORE_LATE only', () => {
    const row = stake({ type: 'MONEYLINE', side: 'TEAM' }, team);
    const ctx = context(emptyLineup);
    const triggers = evaluateStake(row, ctx);
    expect(triggers).toEqual(evaluateOneScoreLate(row, ctx));
    expect(triggers.map((trigger) => trigger.code)).toEqual(['ONE_SCORE_LATE']);
  });

  it('returns both late triggers for one SURVIVOR stake', () => {
    const row = stake({ type: 'SURVIVOR' }, team);
    const ctx = context(emptyLineup);
    const triggers = evaluateStake(row, ctx);
    expect(triggers).toEqual([
      ...evaluateOneScoreLate(row, ctx),
      ...evaluatePickTrailing2h(row, ctx),
    ]);
    expect(triggers.map((trigger) => trigger.code)).toEqual(['ONE_SCORE_LATE', 'PICK_TRAILING_2H']);
  });

  it('routes SPREAD to the spread evaluator', () => {
    const row = stake({ type: 'SPREAD', line: -3.5 }, team);
    const ctx = context(emptyLineup, game({ scoreHome: 0, scoreAway: 3.5 }));
    const triggers = evaluateStake(row, ctx);
    expect(triggers).toEqual(evaluateSpreadSwing(row, ctx));
    expect(triggers.map((trigger) => trigger.code)).toEqual(['SPREAD_SWING']);
  });

  it('routes TOTAL_OVER and TOTAL_UNDER to the total evaluator', () => {
    const state = game({ scoreHome: 24, scoreAway: 23 });
    for (const type of ['TOTAL_OVER', 'TOTAL_UNDER'] as const) {
      const row = stake({ type, line: 47 }, gameSubject);
      const ctx = context(emptyLineup, state);
      const triggers = evaluateStake(row, ctx);
      expect(triggers).toEqual(evaluateTotalSwing(row, ctx));
      expect(triggers.map((trigger) => trigger.code)).toEqual(['TOTAL_SWING']);
    }
  });

  it('returns [] for STAT_OVER and STAT_UNDER', () => {
    const ctx = context(phiOffense);
    expect(
      evaluateStake(stake({ type: 'STAT_OVER', stat: 'RUSH_YDS', line: 80 }, player), ctx),
    ).toEqual([]);
    expect(
      evaluateStake(stake({ type: 'STAT_UNDER', stat: 'REC_YDS', line: 40 }, player), ctx),
    ).toEqual([]);
  });
});
