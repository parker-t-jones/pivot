import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { evaluateOneScoreLate } from './oneScoreLate.js';

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

/** PHI is away, so its margin is scoreAway − scoreHome. */
function phiMargin(margin: number, overrides: Partial<GameState> = {}): GameState {
  const scores =
    margin >= 0 ? { scoreHome: 0, scoreAway: margin } : { scoreHome: -margin, scoreAway: 0 };
  return game({ ...scores, ...overrides });
}

function stake(overrides: Partial<Stake> = {}): Stake {
  return {
    id: 'stake-phi',
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject: { type: 'TEAM', teamId: PHI },
    condition: { type: 'MONEYLINE', side: 'TEAM' },
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function context(state: GameState): EvaluatorContext {
  return { gameId: state.gameId, game: state, lineup };
}

function leverage(state: GameState): number {
  return evaluateOneScoreLate(stake(), context(state))[0]?.leverage ?? -1;
}

describe('evaluateOneScoreLate', () => {
  it('emits nothing for a blowout', () => {
    expect(evaluateOneScoreLate(stake(), context(phiMargin(17)))).toEqual([]);
    expect(evaluateOneScoreLate(stake(), context(phiMargin(-17)))).toEqual([]);
  });

  it('fires at margin 8 and not at margin 9', () => {
    for (const margin of [8, -8]) {
      const triggers = evaluateOneScoreLate(stake(), context(phiMargin(margin)));
      expect(triggers.map((trigger) => trigger.code)).toEqual(['ONE_SCORE_LATE']);
      expect(triggers[0]?.kind).toBe('REVEAL');
      expect(triggers[0]?.dedupeKey).toBe('stake-phi:ONE_SCORE_LATE');
    }
    expect(evaluateOneScoreLate(stake(), context(phiMargin(9)))).toEqual([]);
    expect(evaluateOneScoreLate(stake(), context(phiMargin(-9)))).toEqual([]);
  });

  it('fires in the fourth quarter and overtime, not in the third', () => {
    expect(evaluateOneScoreLate(stake(), context(phiMargin(3, { quarter: 3 })))).toEqual([]);
    expect(evaluateOneScoreLate(stake(), context(phiMargin(3, { quarter: 4 })))).toHaveLength(1);
    expect(evaluateOneScoreLate(stake(), context(phiMargin(3, { quarter: 5 })))).toHaveLength(1);
  });

  it('fires for a survivor stake on the same rule', () => {
    const survivor = stake({ condition: { type: 'SURVIVOR' } });
    expect(evaluateOneScoreLate(survivor, context(phiMargin(3)))).toHaveLength(1);
  });

  it('returns [] for a final game', () => {
    expect(evaluateOneScoreLate(stake(), context(phiMargin(0, { status: 'final' })))).toEqual([]);
  });

  it('returns [] when team ids are missing or the subject team is not playing', () => {
    expect(
      evaluateOneScoreLate(stake(), context(phiMargin(0, { homeTeamId: '', awayTeamId: '' }))),
    ).toEqual([]);
    expect(
      evaluateOneScoreLate(
        stake({ subject: { type: 'TEAM', teamId: 'DAL' } }),
        context(phiMargin(0)),
      ),
    ).toEqual([]);
  });

  it('returns [] for the wrong condition, subject, or game', () => {
    const live = context(phiMargin(0));
    expect(evaluateOneScoreLate(stake({ condition: { type: 'SPREAD', line: -3 } }), live)).toEqual(
      [],
    );
    expect(
      evaluateOneScoreLate(stake({ subject: { type: 'GAME', gameId: GAME_ID } }), live),
    ).toEqual([]);
    expect(evaluateOneScoreLate(stake({ gameId: 'other-game' }), live)).toEqual([]);
  });

  it('keeps REVEAL leverage in [0, 1], tighter as the margin shrinks, and higher later', () => {
    const margins = [0, 4, 8];
    const leverages = margins.map((margin) => leverage(phiMargin(margin, { timeRemainingSec: 0 })));
    expect(leverages[0]).toBeGreaterThan(leverages[1] ?? 0);
    expect(leverages[1]).toBeGreaterThan(leverages[2] ?? 0);
    for (const value of leverages) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }

    const early = leverage(phiMargin(0, { timeRemainingSec: 800 }));
    const late = leverage(phiMargin(0, { timeRemainingSec: 100 }));
    const ot = leverage(phiMargin(0, { quarter: 5, timeRemainingSec: 600 }));
    expect(late).toBeGreaterThan(early);
    expect(ot).toBeGreaterThan(leverage(phiMargin(0, { quarter: 4, timeRemainingSec: 600 })));
    expect(ot).toBeLessThanOrEqual(1);
  });
});
