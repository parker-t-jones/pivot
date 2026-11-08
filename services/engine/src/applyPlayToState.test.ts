import { describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import type { Clock } from './clock.js';
import type { PlayEvent, PlayType } from './playEvent.js';
import { applyPlayToState, possessionChangeAtPlayEnd } from './applyPlayToState.js';

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
    const state = applyPlayToState(
      null,
      makePlay({ possessionTeamId: null, playType: 'run' }),
      clock,
    );
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
    const state = applyPlayToState(
      null,
      makePlay({ quarter: 3, secondsRemainingInQuarter: 42 }),
      clock,
    );
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
      makePlay({
        possessionTeamId: null,
        playType: 'timeout',
        yardsToOpponentEndzone: null,
        down: null,
        distance: null,
      }),
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
    const previous = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'pass' }),
      clock,
    );
    const duringWarning = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'end_period' }),
      clock,
    );
    expect(duringWarning.possessionTeamId).toBe('KC');
    expect(duringWarning.unitOnField).toBe('offense');
  });

  it('does NOT carry possession forward through an end_half (real intermission)', () => {
    const previous = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'run' }),
      clock,
    );
    const atHalftime = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: null, playType: 'end_half' }),
      clock,
    );
    expect(atHalftime.possessionTeamId).toBeNull();
    expect(atHalftime.unitOnField).toBe('none');
  });

  it('does NOT carry possession forward through an end_game', () => {
    const previous = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'run' }),
      clock,
    );
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
    const previous = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'run' }),
      clock,
    );
    const freshDrivePenalty = applyPlayToState(
      previous,
      makePlay({ possessionTeamId: 'LV', playType: 'no_play' }),
      clock,
    );
    expect(freshDrivePenalty.possessionTeamId).toBe('LV');
    expect(freshDrivePenalty.unitOnField).toBe('none');
  });

  it('does not carry a no_play forward when there is no previous state', () => {
    const state = applyPlayToState(
      null,
      makePlay({ possessionTeamId: 'KC', playType: 'no_play' }),
      clock,
    );
    expect(state.unitOnField).toBe('none');
  });
});

describe('possessionChangeAtPlayEnd — the play that hands the ball over (issue #7)', () => {
  // KC (away) has the ball going in, mid-Q2, 0-0.
  const before = applyPlayToState(null, makePlay(), clock);

  it.each<[string, Partial<PlayEvent>]>([
    ['a punt', { playType: 'punt' }],
    ['an interception', { playType: 'pass' }],
    ['a lost fumble', { playType: 'run' }],
    ['a turnover on downs', { playType: 'pass', down: 4 }],
    ['a missed field goal', { playType: 'field_goal' }],
  ])('flips to the receiving team on %s', (_label, overrides) => {
    const play = makePlay({
      quarter: 2,
      secondsRemainingInQuarter: 400,
      ...overrides,
      endPossessionTeamId: 'LV',
    });

    expect(possessionChangeAtPlayEnd(before, play)).toBe('LV');
    expect(applyPlayToState(before, play, clock)).toMatchObject({
      possessionTeamId: 'LV',
      unitOnField: 'offense',
      yardsToOpponentEndzone: null,
      down: null,
      distance: null,
      inRedZone: false,
    });
  });

  it('flips a kickoff after a score to the receiving team (ESPN files it under their drive)', () => {
    // KC scored a touchdown and kicks off; the kickoff sits in LV's drive.
    const afterTouchdown = applyPlayToState(
      null,
      makePlay({ playType: 'extra_point', scoreAway: 7 }),
      clock,
    );
    const kickoff = makePlay({
      playType: 'kickoff',
      possessionTeamId: 'LV',
      scoreAway: 7,
      endPossessionTeamId: 'LV',
    });

    expect(possessionChangeAtPlayEnd(afterTouchdown, kickoff)).toBe('LV');
    expect(applyPlayToState(afterTouchdown, kickoff, clock).unitOnField).toBe('offense');
  });

  it('flips the second-half kickoff after an end_half, when nobody had the ball', () => {
    const halftime = applyPlayToState(
      before,
      makePlay({
        playType: 'end_half',
        possessionTeamId: null,
        quarter: 2,
        secondsRemainingInQuarter: 0,
      }),
      clock,
    );
    const kickoff = makePlay({
      playType: 'kickoff',
      possessionTeamId: 'KC',
      quarter: 3,
      endPossessionTeamId: 'KC',
    });

    expect(possessionChangeAtPlayEnd(halftime, kickoff)).toBe('KC');
  });

  it('flips with no previous state (first play the runner sees)', () => {
    expect(
      possessionChangeAtPlayEnd(null, makePlay({ playType: 'punt', endPossessionTeamId: 'LV' })),
    ).toBe('LV');
  });

  it('does not flip when end.team names the same team (own-recovery fumble, muff kept by the kicker)', () => {
    expect(possessionChangeAtPlayEnd(before, makePlay({ endPossessionTeamId: 'KC' }))).toBeNull();
    expect(
      possessionChangeAtPlayEnd(before, makePlay({ playType: 'punt', endPossessionTeamId: 'KC' })),
    ).toBeNull();
    expect(
      applyPlayToState(before, makePlay({ endPossessionTeamId: 'KC' }), clock)
        .yardsToOpponentEndzone,
    ).toBe(50);
  });

  it('does not flip when the source gave no end-of-play team (old behavior)', () => {
    const punt = makePlay({ playType: 'punt' });
    expect(possessionChangeAtPlayEnd(before, punt)).toBeNull();
    expect(possessionChangeAtPlayEnd(before, { ...punt, endPossessionTeamId: null })).toBeNull();
    expect(applyPlayToState(before, punt, clock)).toMatchObject({
      possessionTeamId: 'KC',
      unitOnField: 'special_teams',
    });
  });

  it('does not flip on a team outside this game', () => {
    expect(possessionChangeAtPlayEnd(before, makePlay({ endPossessionTeamId: 'DEN' }))).toBeNull();
  });

  it.each<PlayType>(['timeout', 'end_period', 'end_half', 'end_game'])(
    'never flips on a %s entry',
    (playType) => {
      const entry = makePlay({ playType, possessionTeamId: null, endPossessionTeamId: 'LV' });
      expect(possessionChangeAtPlayEnd(before, entry)).toBeNull();
    },
  );

  it('never flips on a pre-snap penalty', () => {
    expect(
      possessionChangeAtPlayEnd(
        before,
        makePlay({ playType: 'no_play', endPossessionTeamId: 'LV' }),
      ),
    ).toBeNull();
  });

  describe('guard: scoring plays', () => {
    it('does not flip on a return touchdown; the play stays with its drive as before', () => {
      const pickSix = makePlay({ playType: 'pass', scoreHome: 6, endPossessionTeamId: 'LV' });

      expect(possessionChangeAtPlayEnd(before, pickSix)).toBeNull();
      expect(applyPlayToState(before, pickSix, clock)).toMatchObject({
        possessionTeamId: 'KC',
        unitOnField: 'offense',
      });
    });

    it('does not flip on a safety', () => {
      const safety = makePlay({ playType: 'run', scoreHome: 2, endPossessionTeamId: 'LV' });
      expect(possessionChangeAtPlayEnd(before, safety)).toBeNull();
    });

    it('flips on the kickoff after a return touchdown, back to the team that was scored on', () => {
      // LV returned an interception for a TD and kicks off to KC.
      const afterReturnTd = applyPlayToState(
        null,
        makePlay({ playType: 'extra_point', possessionTeamId: 'LV', scoreHome: 7 }),
        clock,
      );
      const kickoff = makePlay({
        playType: 'kickoff',
        possessionTeamId: 'KC',
        scoreHome: 7,
        endPossessionTeamId: 'KC',
      });
      expect(possessionChangeAtPlayEnd(afterReturnTd, kickoff)).toBe('KC');
    });
  });

  describe('guard: Q2 or Q4 with 0:10 or less on the play clock', () => {
    it.each<[string, Partial<PlayEvent>]>([
      ['a punt at 0:06 Q2', { playType: 'punt', quarter: 2, secondsRemainingInQuarter: 6 }],
      [
        'an interception at 0:03 Q2',
        { playType: 'pass', quarter: 2, secondsRemainingInQuarter: 3 },
      ],
      [
        'an interception at 0:08 Q4',
        { playType: 'pass', quarter: 4, secondsRemainingInQuarter: 8 },
      ],
      [
        'a punt at exactly 0:10 Q4',
        { playType: 'punt', quarter: 4, secondsRemainingInQuarter: 10 },
      ],
      [
        'a missed field goal at 0:02 Q2',
        { playType: 'field_goal', quarter: 2, secondsRemainingInQuarter: 2 },
      ],
      [
        'a turnover on downs at 0:00 Q4',
        { playType: 'pass', quarter: 4, secondsRemainingInQuarter: 0 },
      ],
    ])('does not flip on %s', (_label, overrides) => {
      const play = makePlay({ ...overrides, endPossessionTeamId: 'LV' });
      expect(possessionChangeAtPlayEnd(before, play)).toBeNull();
    });

    it('does not flip on a kickoff at 0:05 Q4', () => {
      const kickoff = makePlay({
        playType: 'kickoff',
        possessionTeamId: 'LV',
        quarter: 4,
        secondsRemainingInQuarter: 5,
        endPossessionTeamId: 'LV',
      });
      expect(possessionChangeAtPlayEnd(before, kickoff)).toBeNull();
    });

    it.each<[string, Partial<PlayEvent>]>([
      ['0:11 Q2', { quarter: 2, secondsRemainingInQuarter: 11 }],
      ['0:05 Q1', { quarter: 1, secondsRemainingInQuarter: 5 }],
      ['0:05 Q3', { quarter: 3, secondsRemainingInQuarter: 5 }],
    ])('flips at %s', (_label, overrides) => {
      const punt = makePlay({ playType: 'punt', ...overrides, endPossessionTeamId: 'LV' });
      expect(possessionChangeAtPlayEnd(before, punt)).toBe('LV');
    });
  });

  it('carries the flipped possession through a timeout, then the first snap fills field position', () => {
    const afterPunt = applyPlayToState(
      before,
      makePlay({ playType: 'punt', endPossessionTeamId: 'LV' }),
      clock,
    );
    const timeout = applyPlayToState(
      afterPunt,
      makePlay({ playType: 'timeout', possessionTeamId: null }),
      clock,
    );
    expect(timeout).toMatchObject({ possessionTeamId: 'LV', unitOnField: 'offense' });

    const penalty = applyPlayToState(
      timeout,
      makePlay({ playType: 'no_play', possessionTeamId: 'LV' }),
      clock,
    );
    expect(penalty).toMatchObject({ possessionTeamId: 'LV', unitOnField: 'offense' });

    const snap = applyPlayToState(
      penalty,
      makePlay({ possessionTeamId: 'LV', yardsToOpponentEndzone: 15, endPossessionTeamId: 'LV' }),
      clock,
    );
    expect(snap).toMatchObject({
      possessionTeamId: 'LV',
      unitOnField: 'offense',
      yardsToOpponentEndzone: 15,
      inRedZone: true,
    });
  });
});
