import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import { computeFlagState } from '../../computeFlagState.js';
import type { EvaluatorContext, Stake, TriggerCode } from '../types.js';
import { evaluateRostered, priorityToLeverage } from './rostered.js';

const PHI = 'PHI';
const CHI = 'CHI';
const GAME_ID = '401872963';

function lineupOf(
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
  return { userId: 'u-replay', week: 3, teamPositions, playerToTeam, starPlayerIds, playerUnits };
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

function rosteredStake(input: {
  playerId: string;
  teamId: string;
  id?: string;
  gameId?: string;
  condition?: Stake['condition'];
  subject?: Stake['subject'];
}): Stake {
  return {
    id: input.id ?? `stake-${input.playerId}`,
    userId: 'u-replay',
    season: 2026,
    week: 3,
    gameId: input.gameId ?? GAME_ID,
    subject: input.subject ?? { type: 'PLAYER', playerId: input.playerId, teamId: input.teamId },
    condition: input.condition ?? { type: 'ROSTERED' },
    source: 'SLEEPER_ROSTER',
    weight: 1,
    createdAt: '2026-09-28T00:00:00.000Z',
  };
}

function context(lineup: UserLineupCache, game: GameState, gameId = game.gameId): EvaluatorContext {
  return { gameId, game, lineup };
}

function codes(
  playerId: string,
  teamId: string,
  lineup: UserLineupCache,
  game: GameState,
): TriggerCode[] {
  return evaluateRostered(rosteredStake({ playerId, teamId }), context(lineup, game)).map(
    (trigger) => trigger.code,
  );
}

/** Copied from `phiChiFlagDiff.test.ts` offenseOnly. One PHI offensive player. */
function phiOffense(withUnits: boolean): UserLineupCache {
  return {
    userId: 'u-replay',
    week: 3,
    teamPositions: new Map([[PHI, new Set<'offense' | 'defense'>(['offense'])]]),
    playerToTeam: new Map([['phi-te', PHI]]),
    starPlayerIds: new Set<string>(),
    ...(withUnits ? { playerUnits: new Map([['phi-te', 'offense'] as const]) } : {}),
  };
}

/** Copied from `phiChiFlagDiff.test.ts` `lineup` (lines 55–73). PHI TE + PHI D/ST. */
function phiTeAndDst(withUnits: boolean): UserLineupCache {
  const cache: UserLineupCache = {
    userId: 'u-replay',
    week: 3,
    teamPositions: new Map([[PHI, new Set<'offense' | 'defense'>(['offense', 'defense'])]]),
    playerToTeam: new Map([
      ['phi-te', PHI],
      ['phi-dst', PHI],
    ]),
    starPlayerIds: new Set<string>(),
  };
  if (withUnits) {
    cache.playerUnits = new Map([
      ['phi-te', 'offense'],
      ['phi-dst', 'defense'],
    ]);
  }
  return cache;
}

/** Copied from `phiChiFlagDiff.test.ts` bothTeams. One PHI player and one CHI player. */
function phiAndChi(withUnits: boolean): UserLineupCache {
  return {
    userId: 'u-replay',
    week: 3,
    teamPositions: new Map([
      [PHI, new Set<'offense' | 'defense'>(['offense'])],
      [CHI, new Set<'offense' | 'defense'>(['offense'])],
    ]),
    playerToTeam: new Map([
      ['phi-te', PHI],
      ['chi-wr', CHI],
    ]),
    starPlayerIds: new Set<string>(),
    ...(withUnits
      ? {
          playerUnits: new Map([['phi-te', 'offense'] as const, ['chi-wr', 'offense'] as const]),
        }
      : {}),
  };
}

function starredPhiTe(): UserLineupCache {
  return { ...phiTeAndDst(true), starPlayerIds: new Set(['phi-te']) };
}

describe('evaluateRostered', () => {
  const offense = lineupOf([{ id: 'rb-phi', team: PHI, unit: 'offense' }]);
  const defense = lineupOf([{ id: 'phi-dst', team: PHI, unit: 'defense' }]);
  // The lineup cache stores K as offense. The evaluator does not special-case the position.
  const kicker = lineupOf([{ id: 'k-phi', team: PHI, unit: 'offense' }]);

  it('emits POSSESSION_START for an offensive player whose team has the ball', () => {
    const triggers = evaluateRostered(
      rosteredStake({ playerId: 'rb-phi', teamId: PHI }),
      context(offense, phiOutside),
    );
    expect(triggers.map((trigger) => trigger.code)).toEqual(['POSSESSION_START']);
    expect(triggers.every((trigger) => trigger.kind === 'NUDGE')).toBe(true);
  });

  it('emits nothing for that offensive player while his team is on defense', () => {
    expect(codes('rb-phi', PHI, offense, chiOutside)).toEqual([]);
  });

  it('emits POSSESSION_START for a D/ST while its team is on defense', () => {
    const triggers = evaluateRostered(
      rosteredStake({ playerId: 'phi-dst', teamId: PHI }),
      context(defense, chiOutside),
    );
    expect(triggers.map((trigger) => trigger.code)).toEqual(['POSSESSION_START']);
    expect(triggers.every((trigger) => trigger.kind === 'NUDGE')).toBe(true);
  });

  it('emits nothing for a D/ST while its team is on offense', () => {
    expect(codes('phi-dst', PHI, defense, phiOutside)).toEqual([]);
  });

  it('adds RED_ZONE when the existing flag logic adds the red-zone reason', () => {
    const triggers = evaluateRostered(
      rosteredStake({ playerId: 'rb-phi', teamId: PHI }),
      context(offense, phiRed),
    );
    expect(triggers.map((trigger) => trigger.code)).toEqual(['POSSESSION_START', 'RED_ZONE']);
    expect(triggers.every((trigger) => trigger.kind === 'NUDGE')).toBe(true);
    const flag = computeFlagState(offense, phiRed);
    expect(triggers.every((trigger) => trigger.leverage === flag.priorityScore / 12)).toBe(true);
  });

  it('emits POSSESSION_START for a kicker whose team is on offense', () => {
    expect(codes('k-phi', PHI, kicker, phiOutside)).toEqual(['POSSESSION_START']);
  });

  it('returns [] for a non-ROSTERED condition, a TEAM subject, and a mismatched gameId', () => {
    const stake = rosteredStake({ playerId: 'rb-phi', teamId: PHI });
    const ctx = context(offense, phiOutside);
    expect(evaluateRostered({ ...stake, condition: { type: 'SURVIVOR' } }, ctx)).toEqual([]);
    expect(evaluateRostered({ ...stake, subject: { type: 'TEAM', teamId: PHI } }, ctx)).toEqual([]);
    expect(evaluateRostered({ ...stake, gameId: 'other-game' }, ctx)).toEqual([]);
  });

  it('returns [] when the player is missing from the cache or the team mismatches', () => {
    const ctx = context(offense, phiOutside);
    expect(evaluateRostered(rosteredStake({ playerId: 'missing', teamId: PHI }), ctx)).toEqual([]);
    expect(evaluateRostered(rosteredStake({ playerId: 'rb-phi', teamId: CHI }), ctx)).toEqual([]);
  });

  it('keeps dedupeKey to stake id and code across different game states', () => {
    const stake = rosteredStake({ playerId: 'rb-phi', teamId: PHI });
    const outside = evaluateRostered(stake, context(offense, phiOutside));
    const late = evaluateRostered(stake, context(offense, q4Close));
    const red = evaluateRostered(stake, context(offense, phiRed));
    const lateRed = evaluateRostered(
      stake,
      context(offense, phiChi({ ...phiRed, quarter: 4, scoreHome: 20, scoreAway: 14 })),
    );
    expect(outside[0]?.dedupeKey).toBe('stake-rb-phi:POSSESSION_START');
    expect(late[0]?.dedupeKey).toBe(outside[0]?.dedupeKey);
    expect(red.find((trigger) => trigger.code === 'RED_ZONE')?.dedupeKey).toBe(
      'stake-rb-phi:RED_ZONE',
    );
    expect(lateRed.find((trigger) => trigger.code === 'RED_ZONE')?.dedupeKey).toBe(
      red.find((trigger) => trigger.code === 'RED_ZONE')?.dedupeKey,
    );
  });

  it('keeps leverage in [0, 1] and never lets a higher priority produce a lower leverage', () => {
    let previous = priorityToLeverage(0);
    expect(previous).toBeGreaterThanOrEqual(0);
    expect(previous).toBeLessThanOrEqual(1);
    for (let priority = 1; priority <= 24; priority += 1) {
      const next = priorityToLeverage(priority);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(1);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(priorityToLeverage(12)).toBe(1);
    expect(priorityToLeverage(13)).toBe(1);
  });

  it('feeds close game and star into leverage and not into trigger codes', () => {
    const starred = lineupOf([{ id: 'rb-phi', team: PHI, unit: 'offense', star: true }]);
    const triggers = evaluateRostered(
      rosteredStake({ playerId: 'rb-phi', teamId: PHI }),
      context(starred, q4Close),
    );
    const flag = computeFlagState(starred, q4Close);
    expect(flag.reasons.map((reason) => reason.type)).toEqual([
      'offense_active',
      'close_game',
      'star_player_active',
    ]);
    expect(triggers.map((trigger) => trigger.code)).toEqual(['POSSESSION_START']);
    expect(triggers[0]?.leverage).toBe(flag.priorityScore / 12);
    expect(triggers[0]?.kind).toBe('NUDGE');
  });
});

describe('evaluateRostered parity with computeFlagState', () => {
  const lineups: { name: string; lineup: UserLineupCache }[] = [
    { name: 'phi offense with units', lineup: phiOffense(true) },
    { name: 'phi offense without units', lineup: phiOffense(false) },
    { name: 'phi te + dst with units', lineup: phiTeAndDst(true) },
    { name: 'phi te + dst without units', lineup: phiTeAndDst(false) },
    { name: 'phi + chi with units', lineup: phiAndChi(true) },
    { name: 'phi + chi without units', lineup: phiAndChi(false) },
    { name: 'starred phi te', lineup: starredPhiTe() },
  ];

  const states: { name: string; game: GameState }[] = [
    { name: 'PHI outside red zone', game: phiOutside },
    { name: 'PHI in red zone', game: phiRed },
    { name: 'CHI outside red zone', game: chiOutside },
    { name: 'CHI in red zone', game: chiRed },
    { name: 'Q4 close game', game: q4Close },
    { name: 'no possession', game: noPossession },
  ];

  it('matches side-of-ball players and the red-zone reason for every lineup and state', () => {
    for (const { name, lineup } of lineups) {
      for (const { name: stateName, game } of states) {
        const flag = computeFlagState(lineup, game);
        const expected = flag.reasons
          .filter((reason) => reason.type === 'offense_active' || reason.type === 'defense_active')
          .flatMap((reason) => reason.triggeringPlayerIds)
          .sort();
        const expectRed = flag.reasons.some((reason) => reason.type === 'red_zone');
        const possession: string[] = [];
        const redZone: string[] = [];

        for (const [playerId, teamId] of lineup.playerToTeam) {
          const triggers = evaluateRostered(
            rosteredStake({ playerId, teamId }),
            context(lineup, game),
          );
          expect(triggers.every((trigger) => trigger.kind === 'NUDGE')).toBe(true);
          for (const trigger of triggers) {
            expect(trigger.leverage).toBeGreaterThanOrEqual(0);
            expect(trigger.leverage).toBeLessThanOrEqual(1);
          }
          if (triggers.some((trigger) => trigger.code === 'POSSESSION_START'))
            possession.push(playerId);
          if (triggers.some((trigger) => trigger.code === 'RED_ZONE')) redZone.push(playerId);
        }

        expect({ lineup: name, state: stateName, possession: possession.sort() }).toEqual({
          lineup: name,
          state: stateName,
          possession: expected,
        });
        expect({ lineup: name, state: stateName, redZone: redZone.sort() }).toEqual({
          lineup: name,
          state: stateName,
          redZone: expectRed ? expected : [],
        });
      }
    }
  });
});
