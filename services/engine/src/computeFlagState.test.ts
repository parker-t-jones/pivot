import { describe, expect, it } from 'vitest';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { Clock } from './clock.js';
import { computeFlagState } from './computeFlagState.js';

// Fixed clock so `computedAt` is deterministic (sprint decision #1: injected clock, not a Section 8
// formula change). Every test passes this; production uses `defaultClock`.
const FIXED_NOW = 1_700_000_000_000;
const clock: Clock = () => FIXED_NOW;

const HOME = 'A';
const AWAY = 'B';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game-1',
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: HOME,
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    timeRemainingSec: 900,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/** Builds a `UserLineupCache` the same way Sprint 3's `refreshLineupCache` does (K → offense). */
function lineupOf(
  players: { id: string; team: string; unit: 'offense' | 'defense'; star?: boolean }[],
): UserLineupCache {
  const teamPositions = new Map<string, Set<'offense' | 'defense'>>();
  const playerToTeam = new Map<string, string>();
  const starPlayerIds = new Set<string>();
  for (const p of players) {
    playerToTeam.set(p.id, p.team);
    const units = teamPositions.get(p.team) ?? new Set<'offense' | 'defense'>();
    units.add(p.unit);
    teamPositions.set(p.team, units);
    if (p.star) starPlayerIds.add(p.id);
  }
  return { userId: 'user-1', week: 8, teamPositions, playerToTeam, starPlayerIds };
}

const EMPTY_UNFLAGGED = {
  gameId: 'game-1',
  flagged: false,
  priorityScore: 0,
  reasons: [],
  computedAt: FIXED_NOW,
};

describe('computeFlagState — basic flag rules', () => {
  it('flags with offense_active (priority 2) when user has an offensive player on the possessing team', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 2,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: ['rb-a'] }],
      computedAt: FIXED_NOW,
    });
  });

  it('does not flag when the user has an offensive player on a team that is on defense', () => {
    // User owns Team A's RB, but Team B has the ball (A's defense is on the field).
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: AWAY, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('flags with defense_active (priority 2) when user has the defending team DEF', () => {
    // Team A has the ball; user owns Team B's DEF, and B is defending.
    const lineup = lineupOf([{ id: 'def-b', team: AWAY, unit: 'defense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 2,
      reasons: [{ type: 'defense_active', triggeringPlayerIds: ['def-b'] }],
      computedAt: FIXED_NOW,
    });
  });

  it('flags with both offense and defense reasons (priority 4) when user has stake on both sides', () => {
    const lineup = lineupOf([
      { id: 'rb-a', team: HOME, unit: 'offense' },
      { id: 'def-b', team: AWAY, unit: 'defense' },
    ]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 4,
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'defense_active', triggeringPlayerIds: ['def-b'] },
      ],
      computedAt: FIXED_NOW,
    });
  });

  it('scales offense priority by number of offensive players (2 players → priority 4)', () => {
    const lineup = lineupOf([
      { id: 'rb-a', team: HOME, unit: 'offense' },
      { id: 'wr-a', team: HOME, unit: 'offense' },
    ]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 4,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: ['rb-a', 'wr-a'] }],
      computedAt: FIXED_NOW,
    });
  });
});

describe('computeFlagState — bonus rules', () => {
  it('adds +3 and a red_zone reason when a flagged game has the ball in the red zone', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense', inRedZone: true });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 5,
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'red_zone', triggeringPlayerIds: [] },
      ],
      computedAt: FIXED_NOW,
    });
  });

  it('does not add a red_zone reason when a flagged game is not in the red zone', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense', inRedZone: false });

    const result = computeFlagState(lineup, state, clock);
    expect(result.reasons.some((r) => r.type === 'red_zone')).toBe(false);
    expect(result.priorityScore).toBe(2);
  });

  it('does NOT apply the red_zone bonus when the game is unflagged (bonuses require a flag)', () => {
    // User has no stake in either team; ball is in the red zone.
    const lineup = lineupOf([{ id: 'rb-x', team: 'X', unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense', inRedZone: true });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('adds +2 and a close_game reason when flagged in Q4 within 7 points', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({
      possessionTeamId: HOME,
      unitOnField: 'offense',
      quarter: 4,
      scoreHome: 20,
      scoreAway: 14,
    });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 4,
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'close_game', triggeringPlayerIds: [] },
      ],
      computedAt: FIXED_NOW,
    });
  });

  it('does not add close_game when flagged in Q4 with a 10-point spread', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({
      possessionTeamId: HOME,
      unitOnField: 'offense',
      quarter: 4,
      scoreHome: 24,
      scoreAway: 14,
    });

    const result = computeFlagState(lineup, state, clock);
    expect(result.reasons.some((r) => r.type === 'close_game')).toBe(false);
    expect(result.priorityScore).toBe(2);
  });

  it('applies close_game in OT (Q5) regardless of score margin', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({
      possessionTeamId: HOME,
      unitOnField: 'offense',
      quarter: 5,
      scoreHome: 30,
      scoreAway: 20, // 10-point spread, but OT always counts as close
    });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 4,
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'close_game', triggeringPlayerIds: [] },
      ],
      computedAt: FIXED_NOW,
    });
  });

  it('adds +5 per star player among the triggering players', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense', star: true }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 7, // 2 (offense) + 5 (star)
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'star_player_active', triggeringPlayerIds: ['rb-a'] },
      ],
      computedAt: FIXED_NOW,
    });
  });

  it('stacks all bonuses (offense + red_zone + close_game + star)', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense', star: true }]);
    const state = makeState({
      possessionTeamId: HOME,
      unitOnField: 'offense',
      inRedZone: true,
      quarter: 4,
      scoreHome: 21,
      scoreAway: 17,
    });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 12, // 2 + 3 + 2 + 5
      reasons: [
        { type: 'offense_active', triggeringPlayerIds: ['rb-a'] },
        { type: 'red_zone', triggeringPlayerIds: [] },
        { type: 'close_game', triggeringPlayerIds: [] },
        { type: 'star_player_active', triggeringPlayerIds: ['rb-a'] },
      ],
      computedAt: FIXED_NOW,
    });
  });
});

describe('computeFlagState — edge cases', () => {
  it('never flags when status is final', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense', star: true }]);
    const state = makeState({
      possessionTeamId: HOME,
      unitOnField: 'offense',
      inRedZone: true,
      status: 'final',
    });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('never flags when status is scheduled', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense', status: 'scheduled' });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('never flags when possessionTeamId is null (halftime / timeout)', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: null, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('does not trigger on special_teams plays (v1 behavior)', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'special_teams' });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('does not trigger between plays (unitOnField none)', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'none' });

    expect(computeFlagState(lineup, state, clock)).toEqual(EMPTY_UNFLAGGED);
  });

  it('treats a kicker on the possessing team as an offensive player (K inherits offense)', () => {
    // Sprint 3's cache categorizes K → 'offense', so a kicker owner flags during normal offense.
    const lineup = lineupOf([{ id: 'k-a', team: HOME, unit: 'offense' }]);
    const state = makeState({ possessionTeamId: HOME, unitOnField: 'offense' });

    expect(computeFlagState(lineup, state, clock)).toEqual({
      gameId: 'game-1',
      flagged: true,
      priorityScore: 2,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: ['k-a'] }],
      computedAt: FIXED_NOW,
    });
  });

  it('stamps computedAt from the injected clock', () => {
    const lineup = lineupOf([{ id: 'rb-a', team: HOME, unit: 'offense' }]);
    const state = makeState();
    const otherClock: Clock = () => 42;

    expect(computeFlagState(lineup, state, otherClock).computedAt).toBe(42);
  });
});
