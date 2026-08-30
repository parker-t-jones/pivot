import type { PlayEvent, PlayType } from './playEvent.js';

/**
 * Resumption detection (PLAN.md Section 8 → "Resumption detection: waiting for the first real play").
 *
 * After a possession change, the question "has play actually resumed?" can't be answered by waiting
 * a fixed padded delay: measured against a real game, the pause is bimodal — roughly a minute when
 * no timeout is called, roughly 2:50 when one is — and nothing about the possession change itself
 * predicts which. So instead of guessing a duration, this waits for concrete evidence: the first
 * play that classifies as real action.
 *
 * Both functions here are pure and provider-agnostic — they read normalized `PlayType`, never a
 * provider's raw taxonomy, so mapping ESPN's `type.id` (or any future source's) is the adapter's job
 * (`@pivot/ingestion`). The logic was validated by replaying a recorded Colts @ Lions game before
 * being promoted here; `resumptionWatcher.test.ts` carries those reference cases forward as
 * regression tests, and `experiments/backtest-resumption.ts` is the original harness.
 */

export type PlayCategory = 'SKIP_AND_WAIT' | 'ABORT' | 'REAL_ACTION';

/**
 * Sorts a normalized play into the three categories the watcher acts on.
 *
 * `REAL_ACTION` is the default rather than an allow-list on purpose: an unrecognized play type fails
 * toward firing instead of silently waiting forever. `ABORT` covers the two stoppages that aren't
 * worth waiting through — an intermission runs far longer than any in-game pause, and a fresh
 * possession change next half restarts the flow naturally, so no "resume after halftime" special
 * case is needed. Providers that can't distinguish halftime from a quarter break should map to
 * `end_period` and accept the wait (see the `PlayType` doc in `playEvent.ts`).
 */
export function classifyPlayType(playType: PlayType): PlayCategory {
  if (playType === 'timeout' || playType === 'end_period') return 'SKIP_AND_WAIT';
  if (playType === 'end_half' || playType === 'end_game') return 'ABORT';
  return 'REAL_ACTION';
}

/**
 * A play paired with the wall-clock time we observed it. `PlayEvent` carries only game-clock fields
 * (`quarter`, `secondsRemainingInQuarter`), but resumption timing is a real-world-elapsed question,
 * so the observation timestamp is supplied alongside it — from the injected `Clock` in a live flow,
 * or from a log timestamp when replaying.
 */
export interface ObservedPlay {
  play: PlayEvent;
  observedAt: number;
}

export type ResumptionResult =
  | { outcome: 'REAL_ACTION'; triggerPlay: ObservedPlay; elapsedMs: number }
  | { outcome: 'ABORTED'; abortPlay: ObservedPlay; elapsedMs: number }
  | { outcome: 'CEILING_FALLBACK'; elapsedMs: number }
  | { outcome: 'NO_MORE_PLAYS'; elapsedMs: number };

/** Safety ceiling: give up and fall back if we've been skipping for this long with no resolution. */
export const RESUMPTION_CEILING_MS = 4 * 60 * 1000;

/**
 * Given the play immediately preceding a possession change (the actual real-world moment possession
 * changed — e.g. the punt, the fumble, the failed 4th down) and the sequence of plays starting from
 * the one that first reveals the new possession (in order), walk forward applying the classifier.
 * Returns the first `REAL_ACTION` play as the trigger, "aborted" on an `ABORT` play, or a ceiling
 * fallback if we spend `RESUMPTION_CEILING_MS` walking through `SKIP_AND_WAIT` plays without
 * resolving.
 *
 * The possession-revealing play (`playsFromPossessionChange[0]`) is classified BEFORE deciding
 * whether to keep scanning, since possession only flips on the new team's first play — that play can
 * itself already be real action (e.g. a punt return's first offensive snap), not merely a "change
 * occurred" marker to skip past. When it's already real action, it's the trigger, with elapsed time
 * measured from the actual possession-change moment (`precedingPlay`); measuring from the revealing
 * play would trivially always be zero. When it's procedural (e.g. a timeout), scanning continues
 * forward anchored on the revealing play itself rather than on `precedingPlay`.
 */
export function watchForResumption(
  precedingPlay: ObservedPlay,
  playsFromPossessionChange: readonly ObservedPlay[],
): ResumptionResult {
  const [revealingPlay, ...subsequentPlays] = playsFromPossessionChange;
  if (!revealingPlay) {
    return { outcome: 'NO_MORE_PLAYS', elapsedMs: 0 };
  }

  const revealingCategory = classifyPlayType(revealingPlay.play.playType);
  const revealingElapsedMs = revealingPlay.observedAt - precedingPlay.observedAt;

  if (revealingCategory === 'REAL_ACTION') {
    return { outcome: 'REAL_ACTION', triggerPlay: revealingPlay, elapsedMs: revealingElapsedMs };
  }
  if (revealingCategory === 'ABORT') {
    return { outcome: 'ABORTED', abortPlay: revealingPlay, elapsedMs: revealingElapsedMs };
  }

  // SKIP_AND_WAIT — keep walking from the revealing play, but bail out if we've waited too long.
  for (const observed of subsequentPlays) {
    const elapsedMs = observed.observedAt - revealingPlay.observedAt;
    const category = classifyPlayType(observed.play.playType);

    if (category === 'REAL_ACTION') {
      return { outcome: 'REAL_ACTION', triggerPlay: observed, elapsedMs };
    }
    if (category === 'ABORT') {
      return { outcome: 'ABORTED', abortPlay: observed, elapsedMs };
    }
    if (elapsedMs >= RESUMPTION_CEILING_MS) {
      return { outcome: 'CEILING_FALLBACK', elapsedMs };
    }
  }

  const lastPlay = subsequentPlays[subsequentPlays.length - 1];
  return {
    outcome: 'NO_MORE_PLAYS',
    elapsedMs: lastPlay ? lastPlay.observedAt - revealingPlay.observedAt : revealingElapsedMs,
  };
}
