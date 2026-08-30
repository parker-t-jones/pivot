import { describe, expect, it } from 'vitest';
import type { PlayEvent, PlayType } from './playEvent.js';
import {
  RESUMPTION_CEILING_MS,
  classifyPlayType,
  watchForResumption,
  type ObservedPlay,
} from './resumptionWatcher.js';

/**
 * The four reference cases below are replayed from the recorded Colts @ Lions game (Aug 29, 2026)
 * that this algorithm was originally validated against — PLAN.md Section 8 "Resumption detection:
 * waiting for the first real play", original harness in `experiments/backtest-resumption.ts`. The
 * wall-clock times are the real observation timestamps from that capture and the expected durations
 * are the hand-analyzed ones, so these lock in measured behavior rather than restating the
 * implementation.
 */
const GAME_DATE = '2026-08-29';

function makePlay(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return {
    playId: 'p1',
    gameId: 'espn:colts-at-lions',
    week: 1,
    homeTeamId: 'DET',
    awayTeamId: 'IND',
    possessionTeamId: 'IND',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 3,
    secondsRemainingInQuarter: 0,
    yardsToOpponentEndzone: 50,
    isFinalPlay: false,
    ...overrides,
  };
}

/**
 * Wall-clock time from the capture → an `ObservedPlay`. Only differences between timestamps matter,
 * so parsing against the local timezone is deterministic regardless of where the suite runs.
 */
function observed(wallClock: string, play: Partial<PlayEvent> = {}): ObservedPlay {
  return {
    play: makePlay(play),
    observedAt: new Date(`${GAME_DATE}T${wallClock}`).getTime(),
  };
}

describe('watchForResumption — reference cases from the recorded Colts @ Lions game', () => {
  it('fires ~2:51 after a fumble, waiting through the official timeout', () => {
    // 15:16:17  R.Williams up the middle ... FUMBLES, RECOVERED by IND-M.Melton  (ESPN 29)
    // 15:16:27  Official Timeout at 01:14                                        (ESPN 74)
    // 15:19:18  E.Stick pass incomplete deep middle to E.Pancol                  (ESPN 3)
    const fumble = observed('15:16:17', { playId: 'fumble', possessionTeamId: 'DET' });
    const timeout = observed('15:16:27', {
      playId: 'timeout',
      playType: 'timeout',
      possessionTeamId: null,
    });
    const incompletion = observed('15:19:18', { playId: 'incompletion', playType: 'pass' });

    expect(watchForResumption(fumble, [timeout, incompletion])).toEqual({
      outcome: 'REAL_ACTION',
      triggerPlay: incompletion,
      elapsedMs: 171_000, // 2:51
    });
  });

  it('fires ~1:02 after a punt, on the return team’s first snap', () => {
    // 15:21:17  R.Sanchez punts 50 yards to DET 18                       (ESPN 52)
    // 15:22:19  J.Dobbs pass incomplete short left to M.Cunningham       (ESPN 3)
    //
    // The regression guard for 25eb470: possession only flips on the receiving team's first snap, so
    // the possession-revealing play here IS the trigger. Scanning past it (the original bug) picked
    // up an unrelated quarter-end gap and computed ~2:50 instead.
    const punt = observed('15:21:17', { playId: 'punt', playType: 'punt' });
    const firstSnap = observed('15:22:19', {
      playId: 'first-snap',
      playType: 'pass',
      possessionTeamId: 'DET',
    });

    expect(watchForResumption(punt, [firstSnap])).toEqual({
      outcome: 'REAL_ACTION',
      triggerPlay: firstSnap,
      elapsedMs: 62_000, // 1:02
    });
  });

  it('fires ~2:50 after a touchdown, waiting through the timeout to the kickoff', () => {
    // 15:33:23  Tr.Williams up the middle for 1 yard, TOUCHDOWN   (ESPN 68)
    // 15:34:05  Official Timeout at 07:25                         (ESPN 74)
    // 15:36:55  J.Bates kicks 62 yards from DET 35 to IND 3       (ESPN 53)
    const touchdown = observed('15:33:23', {
      playId: 'touchdown',
      possessionTeamId: 'DET',
      quarter: 4,
    });
    const timeout = observed('15:34:05', {
      playId: 'timeout',
      playType: 'timeout',
      possessionTeamId: null,
      quarter: 4,
    });
    const kickoff = observed('15:36:55', {
      playId: 'kickoff',
      playType: 'kickoff',
      possessionTeamId: 'DET',
      quarter: 4,
    });

    expect(watchForResumption(touchdown, [timeout, kickoff])).toEqual({
      outcome: 'REAL_ACTION',
      triggerPlay: kickoff,
      elapsedMs: 170_000, // 2:50
    });

    // The other hand-analyzed number for this case. It isn't a watcher output — the timeout is
    // procedural, so the watcher scans past it — but the 0:42 touchdown-to-timeout gap is what the
    // capture measured, so pin the fixture timeline to it.
    expect(timeout.observedAt - touchdown.observedAt).toBe(42_000); // 0:42
  });

  it('fires ~2:49 after a turnover on downs, waiting through the official timeout', () => {
    // 15:43:48  E.Stick pass incomplete short middle to R.Sharpe (4th & 6)  (ESPN 3)
    // 15:43:48  Official Timeout at 04:23                                   (ESPN 74)
    // 15:46:37  R.Williams right tackle to IND 45 for 4 yards               (ESPN 5)
    //
    // The turnover and the timeout landed in the same poll, so they share a timestamp — the anchor
    // choice is unobservable here, unlike the punt case above.
    const fourthDown = observed('15:43:48', { playId: 'fourth-down', playType: 'pass', quarter: 4 });
    const timeout = observed('15:43:48', {
      playId: 'timeout',
      playType: 'timeout',
      possessionTeamId: null,
      quarter: 4,
    });
    const rush = observed('15:46:37', { playId: 'rush', possessionTeamId: 'DET', quarter: 4 });

    expect(watchForResumption(fourthDown, [timeout, rush])).toEqual({
      outcome: 'REAL_ACTION',
      triggerPlay: rush,
      elapsedMs: 169_000, // 2:49
    });
  });
});

describe('watchForResumption — abort, ceiling, and exhaustion paths', () => {
  const start = observed('15:00:00', { playType: 'punt' });

  it('cancels when the possession-revealing play is itself the end of a half', () => {
    const endHalf = observed('15:00:20', { playId: 'end-half', playType: 'end_half' });

    expect(watchForResumption(start, [endHalf])).toEqual({
      outcome: 'ABORTED',
      abortPlay: endHalf,
      elapsedMs: 20_000,
    });
  });

  it('cancels when an abort turns up later in the scan', () => {
    const timeout = observed('15:00:10', { playType: 'timeout', possessionTeamId: null });
    const endGame = observed('15:01:00', { playId: 'end-game', playType: 'end_game' });

    expect(watchForResumption(start, [timeout, endGame])).toEqual({
      outcome: 'ABORTED',
      abortPlay: endGame,
      elapsedMs: 50_000,
    });
  });

  it('falls back and fires once the ceiling is reached with nothing but procedural plays', () => {
    const procedural = (wallClock: string, playType: PlayType = 'timeout'): ObservedPlay =>
      observed(wallClock, { playType, possessionTeamId: null });

    const result = watchForResumption(start, [
      procedural('15:00:10'),
      procedural('15:01:10', 'end_period'),
      procedural('15:02:10'),
      procedural('15:03:10'),
      procedural('15:04:10'),
    ]);

    expect(result).toEqual({ outcome: 'CEILING_FALLBACK', elapsedMs: RESUMPTION_CEILING_MS });
  });

  it('reports exhaustion when the plays run out before anything resolves', () => {
    const timeout = observed('15:00:10', { playType: 'timeout', possessionTeamId: null });
    const stillWaiting = observed('15:00:40', { playType: 'end_period', possessionTeamId: null });

    expect(watchForResumption(start, [timeout, stillWaiting])).toEqual({
      outcome: 'NO_MORE_PLAYS',
      elapsedMs: 30_000,
    });
  });

  it('reports exhaustion when there are no plays after the possession change at all', () => {
    expect(watchForResumption(start, [])).toEqual({ outcome: 'NO_MORE_PLAYS', elapsedMs: 0 });
  });
});

describe('classifyPlayType', () => {
  const skipAndWait: PlayType[] = ['timeout', 'end_period'];
  const abort: PlayType[] = ['end_half', 'end_game'];
  const realAction: PlayType[] = [
    'pass',
    'run',
    'qb_kneel',
    'qb_spike',
    'two_point_attempt',
    'punt',
    'field_goal',
    'kickoff',
    'extra_point',
    'no_play',
  ];

  it.each(skipAndWait)('waits through %s', (playType) => {
    expect(classifyPlayType(playType)).toBe('SKIP_AND_WAIT');
  });

  it.each(abort)('cancels on %s', (playType) => {
    expect(classifyPlayType(playType)).toBe('ABORT');
  });

  it.each(realAction)('treats %s as real action', (playType) => {
    expect(classifyPlayType(playType)).toBe('REAL_ACTION');
  });

  it('covers every PlayType member across the three categories', () => {
    expect(new Set([...skipAndWait, ...abort, ...realAction]).size).toBe(14);
  });

  it('fails toward firing rather than waiting forever on an unrecognized type', () => {
    // Guards the default branch: a provider emitting something outside the union (or a member added
    // without revisiting this file) must fire, not silently stall the watcher.
    expect(classifyPlayType('some_unmapped_type' as PlayType)).toBe('REAL_ACTION');
  });
});
