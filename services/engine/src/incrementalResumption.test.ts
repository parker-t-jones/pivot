import { describe, expect, it } from 'vitest';
import { IncrementalResumptionTracker } from './incrementalResumption.js';
import type { PlayEvent } from './playEvent.js';
import { watchForResumption, type ObservedPlay } from './resumptionWatcher.js';

function play(overrides: Partial<PlayEvent>): PlayEvent {
  return {
    playId: 'p',
    gameId: 'g1',
    week: 1,
    homeTeamId: 'DET',
    awayTeamId: 'IND',
    possessionTeamId: 'IND',
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 600,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

function tracker(): IncrementalResumptionTracker {
  return new IncrementalResumptionTracker('g1', { onResolved: () => undefined });
}

describe('IncrementalResumptionTracker', () => {
  it('resolves REAL_ACTION on the same play that reveals the new possession', () => {
    const source = tracker();
    const now = Date.now();
    expect(
      source.observe(play({ playId: 'punt', playType: 'punt', possessionTeamId: 'IND' }), now),
    ).toBeNull();

    const resolution = source.observe(
      play({ playId: 'snap', playType: 'pass', possessionTeamId: 'DET' }),
      now + 1_000,
    );

    expect(resolution?.outcome).toBe('REAL_ACTION');
    if (resolution?.outcome === 'REAL_ACTION') {
      expect(resolution.triggerPlay.play.playId).toBe('snap');
      expect(resolution.resolvedBy).toBe('watcher');
    }
    expect(source.isWindowOpen()).toBe(false);
    source.dispose();
  });

  it('feeds timeout-then-snap and returns one REAL_ACTION on the snap', () => {
    const source = tracker();
    const now = Date.now();
    source.observe(play({ playId: 'punt', playType: 'punt', possessionTeamId: 'IND' }), now);
    expect(
      source.observe(
        play({ playId: 'timeout', playType: 'timeout', possessionTeamId: null }),
        now + 1_000,
      ),
    ).toBeNull();

    const resolution = source.observe(
      play({ playId: 'snap', playType: 'run', possessionTeamId: 'DET' }),
      now + 2_000,
    );

    expect(resolution?.outcome).toBe('REAL_ACTION');
    if (resolution?.outcome === 'REAL_ACTION') {
      expect(resolution.triggerPlay.play.playId).toBe('snap');
    }
    source.dispose();
  });

  it('aborts when the play that reveals the new possession ends the half', () => {
    const source = tracker();
    const now = Date.now();
    source.observe(play({ playId: 'punt', playType: 'punt', possessionTeamId: 'IND' }), now);

    const resolution = source.observe(
      play({ playId: 'half', playType: 'end_half', possessionTeamId: 'DET' }),
      now + 1_000,
    );

    expect(resolution?.outcome).toBe('ABORTED');
    expect(source.isWindowOpen()).toBe(false);
    source.dispose();
  });
});

describe('watchForResumption with no later play', () => {
  it('does not return CEILING_FALLBACK when no play follows the possession change', () => {
    const preceding: ObservedPlay = {
      play: play({ playId: 'punt', playType: 'punt' }),
      observedAt: 0,
    };

    const result = watchForResumption(preceding, []);

    expect(result.outcome).not.toBe('CEILING_FALLBACK');
    expect(result).toEqual({ outcome: 'NO_MORE_PLAYS', elapsedMs: 0 });
  });
});
