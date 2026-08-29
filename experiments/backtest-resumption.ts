/**
 * ONE-OFF THROWAWAY VALIDATION SCRIPT — not part of the Pivot app, not production code.
 *
 * Backtests the "wait for first real play after a possession change" idea against the
 * already-captured Colts @ Lions game log (experiments/game-latency-log.txt, produced by
 * experiments/espn-latency-probe.ts). Purely offline — reads a log file, touches no live
 * pipeline, no network calls.
 *
 * The classifier and resumption watcher below are written as small, pure functions,
 * deliberately kept separate from the log-parsing/replay harness beneath them, since this
 * is the logic a real ingestion service would eventually reuse (given a possession-change
 * event and a stream of subsequent plays with ESPN type IDs, decide when — if ever — to fire).
 *
 * Usage:
 *   npx tsx experiments/backtest-resumption.ts
 *
 * Requires experiments/game-latency-log.txt to already exist (run the probe first, or use
 * a previously captured log — see espn-latency-probe.ts).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, 'game-latency-log.txt');

// ---------------------------------------------------------------------------
// 1. Classifier — pure, reusable. Exact rule as specified, kept branch-for-branch
//    traceable to the given pseudocode rather than collapsed into one lookup set.
// ---------------------------------------------------------------------------

export type PlayCategory = 'SKIP_AND_WAIT' | 'ABORT' | 'REAL_ACTION';

export function classifyPlayType(typeId: string): PlayCategory {
  if (['74', '21', '75'].includes(typeId)) return 'SKIP_AND_WAIT'; // Official Timeout, Timeout, Two-minute warning
  if (['2'].includes(typeId)) return 'SKIP_AND_WAIT'; // End Period
  if (['65', '66'].includes(typeId)) return 'ABORT'; // End of Half, End of Game
  return 'REAL_ACTION'; // default — unrecognized types fail toward firing, not toward waiting forever
}

// ---------------------------------------------------------------------------
// 2. Resumption watcher — pure, reusable.
// ---------------------------------------------------------------------------

export interface ResumptionPlay {
  typeId: string;
  typeText: string;
  timestampMs: number;
  description: string;
}

export type ResumptionResult =
  | { outcome: 'REAL_ACTION'; triggerPlay: ResumptionPlay; elapsedMs: number }
  | { outcome: 'ABORTED'; abortPlay: ResumptionPlay; elapsedMs: number }
  | { outcome: 'CEILING_FALLBACK'; elapsedMs: number }
  | { outcome: 'NO_MORE_PLAYS'; elapsedMs: number };

/** Safety ceiling: give up and fall back if we've been skipping for this long with no resolution. */
export const RESUMPTION_CEILING_MS = 4 * 60 * 1000;

/**
 * Given a possession-change event and the plays that follow it (in order), walk forward
 * applying the classifier. Returns the first REAL_ACTION play as the trigger (with elapsed
 * time since the possession-change event), "aborted" on an ABORT play, or a ceiling fallback
 * if we spend RESUMPTION_CEILING_MS walking through SKIP_AND_WAIT plays without resolving.
 */
export function watchForResumption(
  changeEvent: ResumptionPlay,
  subsequentPlays: ResumptionPlay[],
): ResumptionResult {
  for (const play of subsequentPlays) {
    const elapsedMs = play.timestampMs - changeEvent.timestampMs;
    const category = classifyPlayType(play.typeId);

    if (category === 'REAL_ACTION') {
      return { outcome: 'REAL_ACTION', triggerPlay: play, elapsedMs };
    }
    if (category === 'ABORT') {
      return { outcome: 'ABORTED', abortPlay: play, elapsedMs };
    }
    // SKIP_AND_WAIT — keep walking, but bail out if we've waited too long.
    if (elapsedMs >= RESUMPTION_CEILING_MS) {
      return { outcome: 'CEILING_FALLBACK', elapsedMs };
    }
  }

  const lastPlay = subsequentPlays[subsequentPlays.length - 1];
  return {
    outcome: 'NO_MORE_PLAYS',
    elapsedMs: lastPlay ? lastPlay.timestampMs - changeEvent.timestampMs : 0,
  };
}

// ---------------------------------------------------------------------------
// 3. Replay harness — log parsing, possession-change detection, not reused elsewhere.
// ---------------------------------------------------------------------------

interface LoggedPlay extends ResumptionPlay {
  quarter: string;
  clock: string;
  downDistance: string;
  possession: string;
}

const LOG_LINE_PATTERN =
  /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s+(Q\d)\s+(\S+)\s+\|\s+(.*?)\s+\|\s+poss:\s+(\S+)\s+\|\s+(.*?)\s+\|\s+type:\s+(\S+)\/"([^"]*)"\s+\|\s+flags:\s+(.*)$/;

function parseLogLine(line: string): LoggedPlay | null {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) return null;
  const [, ts, quarter, clock, downDistance, possession, text, typeId, typeText] = match;

  // Local timestamps have no timezone in the log; treat them as a simple sortable value by
  // parsing as local time. Fine for a single game's worth of same-day, same-timezone data.
  const timestampMs = new Date(ts.replace(' ', 'T')).getTime();

  return {
    quarter,
    clock,
    downDistance,
    possession,
    typeId,
    typeText,
    timestampMs,
    description: text,
  };
}

async function readLoggedPlays(): Promise<LoggedPlay[]> {
  let raw: string;
  try {
    raw = await readFile(LOG_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read ${LOG_PATH}. Run experiments/espn-latency-probe.ts first to produce a ` +
        `log to backtest against.\n(${String(err)})`,
    );
  }

  const plays: LoggedPlay[] = [];
  for (const line of raw.split('\n')) {
    const parsed = parseLogLine(line);
    if (parsed) plays.push(parsed);
  }
  return plays;
}

interface PossessionChangeEvent {
  index: number; // index into the full plays array
  play: LoggedPlay;
  previousPossession: string;
}

function findPossessionChangeEvents(plays: LoggedPlay[]): PossessionChangeEvent[] {
  const events: PossessionChangeEvent[] = [];
  for (let i = 1; i < plays.length; i++) {
    if (plays[i].possession !== plays[i - 1].possession) {
      events.push({ index: i, play: plays[i], previousPossession: plays[i - 1].possession });
    }
  }
  return events;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatOutcome(result: ResumptionResult): string {
  switch (result.outcome) {
    case 'REAL_ACTION':
      return `fired after ${formatDuration(result.elapsedMs)} on "${result.triggerPlay.typeId}/${result.triggerPlay.typeText}": ${result.triggerPlay.description.slice(0, 70)}`;
    case 'ABORTED':
      return `cancelled, no trigger (hit ${result.abortPlay.typeId}/${result.abortPlay.typeText} after ${formatDuration(result.elapsedMs)})`;
    case 'CEILING_FALLBACK':
      return `ceiling fallback fired after ${formatDuration(result.elapsedMs)}`;
    case 'NO_MORE_PLAYS':
      return `no more plays in log to resolve (${formatDuration(result.elapsedMs)} of data available)`;
  }
}

// ---------------------------------------------------------------------------
// 4. Comparison against the four hand-analyzed cases.
// ---------------------------------------------------------------------------

interface ReferenceCase {
  label: string;
  /** Unique substring in the play description that anchors this case in the log. */
  anchorText: string;
  expectedElapsedSeconds: number;
  toleranceSeconds: number;
}

const REFERENCE_CASES: ReferenceCase[] = [
  {
    label: 'fumble -> timeout -> play',
    anchorText: 'RECOVERED by IND-M.Melton',
    expectedElapsedSeconds: 171, // ~2:51
    toleranceSeconds: 15,
  },
  {
    label: 'punt -> play',
    anchorText: 'R.Sanchez punts 50 yards',
    expectedElapsedSeconds: 62, // ~1:02
    toleranceSeconds: 15,
  },
  {
    label: 'turnover-on-downs -> timeout -> play',
    anchorText: 'E.Stick pass incomplete short middle to R.Sharpe (K.Abney)',
    expectedElapsedSeconds: 169, // ~2:49
    toleranceSeconds: 15,
  },
];

function findPlayIndexByAnchor(plays: LoggedPlay[], anchorText: string): number {
  const matches = plays
    .map((play, index) => ({ play, index }))
    .filter(({ play }) => play.description.includes(anchorText));
  if (matches.length === 0) {
    throw new Error(`Reference case anchor not found in log: "${anchorText}"`);
  }
  if (matches.length > 1) {
    throw new Error(`Reference case anchor is not unique in log (${matches.length} matches): "${anchorText}"`);
  }
  return matches[0].index;
}

function runKnownCaseComparisons(
  plays: LoggedPlay[],
  events: PossessionChangeEvent[],
): void {
  console.log('\n=== Comparison against hand-analyzed cases ===\n');

  for (const refCase of REFERENCE_CASES) {
    let anchorIndex: number;
    try {
      anchorIndex = findPlayIndexByAnchor(plays, refCase.anchorText);
    } catch (err) {
      console.log(`[${refCase.label}] MISMATCH — ${String(err instanceof Error ? err.message : err)}`);
      continue;
    }

    const event = events.find((e) => e.index >= anchorIndex);
    if (!event) {
      console.log(
        `[${refCase.label}] MISMATCH — no possession-change event detected at/after the anchor play ` +
          `("${plays[anchorIndex].description.slice(0, 60)}...")`,
      );
      continue;
    }

    const result = watchForResumption(event.play, plays.slice(event.index + 1));
    const actualSeconds = result.outcome === 'NO_MORE_PLAYS' ? null : Math.round(result.elapsedMs / 1000);
    const withinTolerance =
      actualSeconds != null &&
      Math.abs(actualSeconds - refCase.expectedElapsedSeconds) <= refCase.toleranceSeconds &&
      result.outcome === 'REAL_ACTION';

    const status = withinTolerance ? 'MATCH' : 'MISMATCH';
    console.log(
      `[${refCase.label}] ${status} — expected ~${formatDuration(refCase.expectedElapsedSeconds * 1000)}, ` +
        `algorithm's detected possession-change event was "${event.play.description.slice(0, 60)}..." ` +
        `(${event.play.typeId}/${event.play.typeText}) -> ${formatOutcome(result)}`,
    );
  }

  // The TD -> timeout -> kickoff case doesn't correspond to a single possession-change ->
  // resumption-watcher trigger the way the other three do (possession, as this script
  // computes it from `poss:`, doesn't flip to the receiving team until their first
  // scrimmage snap — the touchdown, the ensuing timeout, and the kickoff itself all still
  // show the scoring team's possession). Compare the three known raw timestamps directly
  // instead of forcing it through the resumption watcher.
  console.log('\n[TD -> timeout -> kickoff] Not a resumption-watcher case (see comment above) —');
  console.log('  comparing the three raw log timestamps directly instead:');
  try {
    const tdIndex = findPlayIndexByAnchor(plays, 'Tr.Williams up the middle for 1 yard, TOUCHDOWN');
    const timeoutIndex = tdIndex + 1;
    const kickoffIndex = tdIndex + 2;
    const td = plays[tdIndex];
    const timeout = plays[timeoutIndex];
    const kickoff = plays[kickoffIndex];

    if (!timeout || !kickoff || classifyPlayType(timeout.typeId) !== 'SKIP_AND_WAIT' || timeout.typeText.toLowerCase() !== 'official timeout') {
      console.log('  MISMATCH — expected the two plays right after the TD to be [Official Timeout, Kickoff], found something else.');
    } else {
      const tdToTimeoutSec = Math.round((timeout.timestampMs - td.timestampMs) / 1000);
      const timeoutToKickoffSec = Math.round((kickoff.timestampMs - timeout.timestampMs) / 1000);
      const tdMatch = Math.abs(tdToTimeoutSec - 42) <= 15;
      const kickoffMatch = Math.abs(timeoutToKickoffSec - 170) <= 15; // ~2:50
      console.log(
        `  TD -> timeout: ${formatDuration(tdToTimeoutSec * 1000)} (expected ~0:42) — ${tdMatch ? 'MATCH' : 'MISMATCH'}`,
      );
      console.log(
        `  timeout -> kickoff: ${formatDuration(timeoutToKickoffSec * 1000)} (expected ~2:50) — ${kickoffMatch ? 'MATCH' : 'MISMATCH'}`,
      );
    }
  } catch (err) {
    console.log(`  MISMATCH — ${String(err instanceof Error ? err.message : err)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const plays = await readLoggedPlays();
  console.log(`Loaded ${plays.length} plays from ${LOG_PATH}`);

  const events = findPossessionChangeEvents(plays);
  console.log(`Detected ${events.length} possession-change events (poss: differs from previous play)\n`);

  console.log('=== Possession-change events and resumption outcomes ===\n');
  for (const event of events) {
    const ts = new Date(event.play.timestampMs).toLocaleTimeString('en-US', { hour12: false });
    const result = watchForResumption(event.play, plays.slice(event.index + 1));
    console.log(
      `[${ts}] ${event.play.quarter} ${event.play.clock} | ${event.previousPossession} -> ${event.play.possession} | ` +
        `event: ${event.play.typeId}/${event.play.typeText} | ${formatOutcome(result)}`,
    );
  }

  runKnownCaseComparisons(plays, events);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
