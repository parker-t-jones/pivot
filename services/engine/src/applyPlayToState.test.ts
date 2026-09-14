import { describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import type { Clock } from './clock.js';
import type { PlayEvent, PlayType } from './playEvent.js';
import { applyPlayToState } from './applyPlayToState.js';

const FIXED_NOW = 1_700_000_000_000;
const clock: Clock = () => FIXED_NOW;

function makePlay(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return {
    playId: 'p1',
    gameId: 'g1',
    week: 8,
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 900,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

describe('applyPlayToState — projection from a play', () => {
  it('builds an in_progress game state from the first play (no previous state)', () => {
    const state = applyPlayToState(null, makePlay(), clock);
    expect(state).toEqual<GameState>({
      gameId: 'g1',
      homeTeamId: 'LV',
      awayTeamId: 'KC',
      possessionTeamId: 'KC',
      unitOnField: 'offense',
      scoreHome: 0,
      scoreAway: 0,
      quarter: 1,
      timeRemainingSec: 900,
      yardsToOpponentEndzone: 50,
      down: 1,
      distance: 10,
      inRedZone: false,
      status: 'in_progress',
      updatedAt: FIXED_NOW,
    });
  });

  it('stamps updatedAt from the injected clock', () => {
    const state = applyPlayToState(null, makePlay(), () => 123);
    expect(state.updatedAt).toBe(123);
  });
});

describe('applyPlayToState — unitOnField mapping', () => {
  const offensePlays: PlayType[] = ['pass', 'run', 'qb_kneel', 'qb_spike', 'two_point_attempt'];
  it.each(offensePlays)('maps %s to offense', (playType) => {
    expect(applyPlayToState(null, makePlay({ playType }), clock).unitOnField).toBe('offense');
  });

  const specialTeamsPlays: PlayType[] = ['punt', 'field_goal', 'kickoff', 'extra_point'];
  it.each(specialTeamsPlays)('maps %s to special_teams', (playType) => {
    expect(applyPlayToState(null, makePlay({ playType }), clock).unitOnField).toBe('special_teams');
  });

  const controlPlays: PlayType[] = ['no_play', 'timeout', 'end_period', 'end_half', 'end_game'];
  it.each(controlPlays)('maps %s to none', (playType) => {
    expect(applyPlayToState(null, makePlay({ playType }), clock).unitOnField).toBe('none');
  });

  it('forces unitOnField to none when no team has possession, even on an offensive play type', () => {
    const state = applyPlayToState(null, makePlay({ possessionTeamId: null, playType: 'run' }), clock);
    expect(state.unitOnField).toBe('none');
    expect(state.possessionTeamId).toBeNull();
  });
});

describe('applyPlayToState — specific transitions', () => {
  it('reflects a possession change', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC' }), clock);
    const next = applyPlayToState(previous, makePlay({ possessionTeamId: 'LV' }), clock);
    expect(next.possessionTeamId).toBe('LV');
  });

  it('enters the red zone when inside the opponent 20', () => {
    expect(applyPlayToState(null, makePlay({ yardsToOpponentEndzone: 15 }), clock).inRedZone).toBe(
      true,
    );
  });

  it('is not in the red zone outside the opponent 20', () => {
    expect(applyPlayToState(null, makePlay({ yardsToOpponentEndzone: 25 }), clock).inRedZone).toBe(
      false,
    );
  });

  it('is not in the red zone when field position is unknown or unpossessed', () => {
    expect(
      applyPlayToState(null, makePlay({ yardsToOpponentEndzone: null }), clock).inRedZone,
    ).toBe(false);
    expect(
      applyPlayToState(null, makePlay({ possessionTeamId: null, yardsToOpponentEndzone: 5 }), clock)
        .inRedZone,
    ).toBe(false);
  });

  it('passes through yardline, down, and distance from the play', () => {
    const state = applyPlayToState(
      null,
      makePlay({ yardsToOpponentEndzone: 32, down: 2, distance: 7 }),
      clock,
    );
    expect(state.yardsToOpponentEndzone).toBe(32);
    expect(state.down).toBe(2);
    expect(state.distance).toBe(7);
  });

  it('nulls yardline/down/distance when the play has no possession', () => {
    const state = applyPlayToState(
      null,
      makePlay({
        possessionTeamId: null,
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
      }),
      clock,
    );
    expect(state.yardsToOpponentEndzone).toBeNull();
    expect(state.down).toBeNull();
    expect(state.distance).toBeNull();
  });

  it('reflects a scoring play in the score fields', () => {
    const state = applyPlayToState(null, makePlay({ scoreHome: 7, scoreAway: 3 }), clock);
    expect(state.scoreHome).toBe(7);
    expect(state.scoreAway).toBe(3);
  });

  it('reflects a quarter change and the quarter clock', () => {
    const state = applyPlayToState(null, makePlay({ quarter: 3, secondsRemainingInQuarter: 42 }), clock);
    expect(state.quarter).toBe(3);
    expect(state.timeRemainingSec).toBe(42);
  });

  it('marks the game final on the final play', () => {
    expect(applyPlayToState(null, makePlay({ isFinalPlay: true }), clock).status).toBe('final');
  });

  it('marks the game final on an end_game play type', () => {
    expect(applyPlayToState(null, makePlay({ playType: 'end_game' }), clock).status).toBe('final');
  });

  it('does not mark the game final at the end of a half', () => {
    expect(applyPlayToState(null, makePlay({ playType: 'end_half' }), clock).status).toBe(
      'in_progress',
    );
  });
});

describe('applyPlayToState — carrying possession forward through a clock stoppage', () => {
  it('carries possession, unit, and field position forward through a timeout', () => {
    const previous = applyPlayToState(
      null,
      makePlay({
        possessionTeamId: 'KC',
        playType: 'run',
        yardsToOpponentEndzone: 15,
        down: 3,
        distance: 2,
      }),
      clock,
    );
    expect(previous.inRedZone).toBe(true);

    const duringTimeout = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'timeout', yardsToOpponentEndzone: null, down: null, distance: null }),
      clock,
    );

    expect(duringTimeout.possessionTeamId).toBe('KC');
    expect(duringTimeout.unitOnField).toBe('offense');
    expect(duringTimeout.yardsToOpponentEndzone).toBe(15);
    expect(duringTimeout.down).toBe(3);
    expect(duringTimeout.distance).toBe(2);
    expect(duringTimeout.inRedZone).toBe(true);
  });

  it('carries possession forward through a two-minute warning (end_period)', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC', playType: 'pass' }), clock);
    const duringWarning = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'end_period' }),
      clock,
    );
    expect(duringWarning.possessionTeamId).toBe('KC');
    expect(duringWarning.unitOnField).toBe('offense');
  });

  it('does NOT carry possession forward through an end_half (real intermission)', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC', playType: 'run' }), clock);
    const atHalftime = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'end_half' }),
      clock,
    );
    expect(atHalftime.possessionTeamId).toBeNull();
    expect(atHalftime.unitOnField).toBe('none');
  });

  it('does NOT carry possession forward through an end_game', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC', playType: 'run' }), clock);
    const atEnd = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'end_game' }),
      clock,
    );
    expect(atEnd.possessionTeamId).toBeNull();
    expect(atEnd.unitOnField).toBe('none');
  });

  it('does not carry anything forward when there is no previous state', () => {
    const duringTimeout = applyPlayToState(
      null,
      makePlay({ possessionTeamId: null, playType: 'timeout' }),
      clock,
    );
    expect(duringTimeout.possessionTeamId).toBeNull();
    expect(duringTimeout.unitOnField).toBe('none');
  });

  it('reflects a real possession change normally (non-stoppage play with new possession)', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC' }), clock);
    const afterTurnover = applyPlayToState(previous, makePlay({ possessionTeamId: 'LV' }), clock);
    expect(afterTurnover.possessionTeamId).toBe('LV');
  });

  it('carries possession forward through a pre-snap-penalty no_play naming the SAME team', () => {
    const previous = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'run', down: 3, distance: 5 }),
      clock,
    );
    const duringPenalty = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: 'KC', playType: 'no_play', down: 3, distance: 10 }),
      clock,
    );
    expect(duringPenalty.possessionTeamId).toBe('KC');
    expect(duringPenalty.unitOnField).toBe('offense');
    // Field position/down-distance are carried from `previous`, not the (also valid) penalty play's
    // own values — the penalty play is treated as a no-op, consistent with `no_play`'s meaning.
    expect(duringPenalty.down).toBe(3);
    expect(duringPenalty.distance).toBe(5);
  });

  it('does NOT carry possession forward through a no_play naming a DIFFERENT team (ambiguous new drive)', () => {
    const previous = applyPlayToState(null, makePlay({ possessionTeamId: 'KC', playType: 'run' }), clock);
    const freshDrivePenalty = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: 'LV', playType: 'no_play' }),
      clock,
    );
    expect(freshDrivePenalty.possessionTeamId).toBe('LV');
    expect(freshDrivePenalty.unitOnField).toBe('none');
  });

  it('does not carry a no_play forward when there is no previous state', () => {
    const state = applyPlayToState(null, makePlay({ possessionTeamId: 'KC', playType: 'no_play' }), clock);
    expect(state.unitOnField).toBe('none');
  });
});
