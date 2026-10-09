import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { EvaluatorContext, Stake } from '../types.js';
import { evaluateOpponentRostered } from './opponentRostered.js';

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

function opponentOf(
  players: { id: string; team: string; unit: 'offense' | 'defense'; star?: boolean }[],
): UserLineupCache {
  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const starPlayerIds = new Set<string>();
  const playerUnits = new Map<string, 'offense' | 'defense'>();
  for (const player of players) {
    playerToTeam.set(player.id, player.team);
    playerUnits.set(player.id, player.unit);
    const units = teamPositions.get(player.team) ?? new Set<'offense' | 'defense'>();
    units.add(player.unit);
    teamPositions.set(player.team, units);
    if (player.star) starPlayerIds.add(player.id);
  }
  return { userId: 'u-opp', week: 3, teamPositions, playerToTeam, starPlayerIds, playerUnits };
}

function phiChi(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_ID,
    homeTeamId: CHI,
    awayTeamId: PHI,
    possessionTeamId: PHI,
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    timeRemainingSec: 600,
    yardsToOpponentEndzone: 75,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const phiOutside = phiChi();
const phiRed = phiChi({ inRedZone: true, yardsToOpponentEndzone: 12 });
const chiOutside = phiChi({ possessionTeamId: CHI, yardsToOpponentEndzone: 55 });
const chiRed = phiChi({ possessionTeamId: CHI, inRedZone: true, yardsToOpponentEndzone: 8 });
const q4Close = phiChi({ quarter: 4, scoreHome: 17, scoreAway: 14, timeRemainingSec: 125 });
const noPossession = phiChi({
  possessionTeamId: null,
  unitOnField: 'none',
  yardsToOpponentEndzone: null,
  down: null,
  distance: null,
});

function opponentStake(input: {
  playerId: string;
  teamId: string;
  gameId?: string;
  condition?: Stake['condition'];
}): Stake {
  return {
    id: `stake-${input.playerId}`,
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: input.gameId ?? GAME_ID,
    subject: { type: 'PLAYER', playerId: input.playerId, teamId: input.teamId },
    condition: input.condition ?? { type: 'OPPONENT_ROSTERED' },
    source: 'SLEEPER_OPPONENT',
    weight: 0.5,
    createdAt: '2026-09-28T00:00:00.000Z',
  };
}

function context(
  game: GameState,
  opponent?: UserLineupCache,
  gameId = game.gameId,
): EvaluatorContext {
  const ctx: EvaluatorContext = { gameId, game, lineup: emptyLineup };
  if (opponent) ctx.opponent = opponent;
  return ctx;
}

describe('evaluateOpponentRostered', () => {
  const wr = opponentOf([{ id: 'wr-phi', team: PHI, unit: 'offense', star: true }]);
  const defense = opponentOf([{ id: 'phi-dst', team: PHI, unit: 'defense' }]);
  const stake = opponentStake({ playerId: 'wr-phi', teamId: PHI });

  it('emits OPP_RED_ZONE for an opponent WR whose team has the ball in the red zone', () => {
    const triggers = evaluateOpponentRostered(stake, context(phiRed, wr));
    expect(triggers.map((trigger) => trigger.code)).toEqual(['OPP_RED_ZONE']);
    expect(triggers[0]?.kind).toBe('NUDGE');
    expect(triggers[0]?.leverage).toBe(5 / 12);
    expect(triggers[0]?.dedupeKey).toBe('stake-wr-phi:OPP_RED_ZONE');
  });

  it('emits nothing while the ball is outside the red zone', () => {
    expect(evaluateOpponentRostered(stake, context(phiOutside, wr))).toEqual([]);
  });

  it('emits nothing while the team is on defense', () => {
    expect(evaluateOpponentRostered(stake, context(chiOutside, wr))).toEqual([]);
    expect(evaluateOpponentRostered(stake, context(chiRed, wr))).toEqual([]);
  });

  it('emits nothing for an opponent D/ST in every state', () => {
    const dst = opponentStake({ playerId: 'phi-dst', teamId: PHI });
    for (const game of [phiOutside, phiRed, chiOutside, chiRed, q4Close, noPossession]) {
      expect(evaluateOpponentRostered(dst, context(game, defense))).toEqual([]);
    }
  });

  it('emits nothing when the player is missing from the opponent cache', () => {
    expect(
      evaluateOpponentRostered(
        opponentStake({ playerId: 'missing', teamId: PHI }),
        context(phiRed, wr),
      ),
    ).toEqual([]);
  });

  it('emits nothing when the opponent cache is absent', () => {
    expect(evaluateOpponentRostered(stake, context(phiRed))).toEqual([]);
  });

  it('emits nothing for a ROSTERED condition', () => {
    expect(
      evaluateOpponentRostered(
        opponentStake({ playerId: 'wr-phi', teamId: PHI, condition: { type: 'ROSTERED' } }),
        context(phiRed, wr),
      ),
    ).toEqual([]);
  });

  it('emits nothing for a mismatched gameId', () => {
    expect(
      evaluateOpponentRostered(
        opponentStake({ playerId: 'wr-phi', teamId: PHI, gameId: 'other-game' }),
        context(phiRed, wr),
      ),
    ).toEqual([]);
  });

  it('keeps dedupeKey stable across states that emit', () => {
    const lateRed = evaluateOpponentRostered(
      stake,
      context(phiChi({ ...phiRed, quarter: 4, scoreHome: 20, scoreAway: 14 }), wr),
    );
    const red = evaluateOpponentRostered(stake, context(phiRed, wr));
    expect(red[0]?.dedupeKey).toBe('stake-wr-phi:OPP_RED_ZONE');
    expect(lateRed[0]?.dedupeKey).toBe(red[0]?.dedupeKey);
    expect(lateRed[0]?.kind).toBe('NUDGE');
  });
});
