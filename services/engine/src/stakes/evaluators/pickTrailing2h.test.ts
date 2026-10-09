import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { evaluatePickTrailing2h } from './pickTrailing2h.js';

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
    possessionTeamId: CHI,
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 3,
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

function stake(overrides: Partial<Stake> = {}): Stake {
  return {
    id: 'stake-phi',
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject: { type: 'TEAM', teamId: PHI },
    condition: { type: 'SURVIVOR' },
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
  return evaluatePickTrailing2h(stake(), context(state))[0]?.leverage ?? -1;
}

describe('evaluatePickTrailing2h', () => {
  it('emits nothing for a blowout lead', () => {
    expect(evaluatePickTrailing2h(stake(), context(phiMargin(17, { quarter: 4 })))).toEqual([]);
  });

  it('does not fire while trailing in the second quarter, fires in the third, and stays silent when tied', () => {
    expect(evaluatePickTrailing2h(stake(), context(phiMargin(-3, { quarter: 2 })))).toEqual([]);

    const trailing = evaluatePickTrailing2h(stake(), context(phiMargin(-3, { quarter: 3 })));
    expect(trailing.map((trigger) => trigger.code)).toEqual(['PICK_TRAILING_2H']);
    expect(trailing[0]?.kind).toBe('REVEAL');
    expect(trailing[0]?.dedupeKey).toBe('stake-phi:PICK_TRAILING_2H');

    expect(evaluatePickTrailing2h(stake(), context(phiMargin(0, { quarter: 4 })))).toEqual([]);
    expect(evaluatePickTrailing2h(stake(), context(phiMargin(-3, { quarter: 5 })))).toHaveLength(1);
  });

  it('returns [] for a final game', () => {
    expect(evaluatePickTrailing2h(stake(), context(phiMargin(-3, { status: 'final' })))).toEqual(
      [],
    );
  });

  it('returns [] when team ids are missing or the subject team is not playing', () => {
    expect(
      evaluatePickTrailing2h(stake(), context(phiMargin(-3, { homeTeamId: '', awayTeamId: '' }))),
    ).toEqual([]);
    expect(
      evaluatePickTrailing2h(
        stake({ subject: { type: 'TEAM', teamId: 'DAL' } }),
        context(phiMargin(-3)),
      ),
    ).toEqual([]);
  });

  it('returns [] for a moneyline, the wrong subject, or another game', () => {
    const live = context(phiMargin(-3));
    expect(
      evaluatePickTrailing2h(stake({ condition: { type: 'MONEYLINE', side: 'TEAM' } }), live),
    ).toEqual([]);
    expect(
      evaluatePickTrailing2h(stake({ subject: { type: 'GAME', gameId: GAME_ID } }), live),
    ).toEqual([]);
    expect(evaluatePickTrailing2h(stake({ gameId: 'other-game' }), live)).toEqual([]);
  });

  it('keeps REVEAL leverage in [0, 1], higher for a smaller deficit, and higher later', () => {
    const tight = leverage(phiMargin(-1, { quarter: 4, timeRemainingSec: 0 }));
    const loose = leverage(phiMargin(-8, { quarter: 4, timeRemainingSec: 0 }));
    expect(tight).toBeGreaterThan(loose);
    expect(tight).toBeGreaterThanOrEqual(0);
    expect(tight).toBeLessThanOrEqual(1);
    expect(loose).toBeGreaterThanOrEqual(0);
    expect(loose).toBeLessThanOrEqual(1);

    const early = leverage(phiMargin(-1, { quarter: 4, timeRemainingSec: 800 }));
    const late = leverage(phiMargin(-1, { quarter: 4, timeRemainingSec: 100 }));
    const ot = leverage(phiMargin(-1, { quarter: 5, timeRemainingSec: 600 }));
    expect(late).toBeGreaterThan(early);
    expect(ot).toBeGreaterThan(leverage(phiMargin(-1, { quarter: 4, timeRemainingSec: 600 })));
    expect(ot).toBeLessThanOrEqual(1);
  });
});
