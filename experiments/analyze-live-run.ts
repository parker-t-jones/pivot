/**
 * THROWAWAY TEST HARNESS CODE — not part of the Pivot app, not production code.
 *
 * Turns a `live-sunday-harness.ts` run into the numbers the test is actually for.
 *
 * Runs in two passes, because one input can only come from a human:
 *
 *   PASS 1 (immediately after the games) — everything derivable from the logs alone: resumption
 *   outcomes, how long the gate actually held events, delivery latency, dedupe integrity across
 *   concurrent games, how many notifications the real rate limit would have eaten, and how much of the
 *   event stream had anything to do with a possession change. Also prints a WORKSHEET: one line per
 *   notification, carrying the fingerprint needed to find that play in the screen recording.
 *
 *   PASS 2 (after scrubbing the recording) — supply the times read off the reference clock and get the
 *   signed gaps. `gap = deliveredAt - broadcastVisibleAt`. POSITIVE means the notification arrived
 *   after the play was already on screen, which is safe. NEGATIVE means it arrived first: a spoiler,
 *   and the binary failure condition for this test.
 *
 * The recording is the primary ground truth. `markers-*.jsonl` keypresses are joined too, as a
 * redundant channel — they carry human reaction lag, so they sanity-check the recording rather than
 * replace it.
 *
 * Usage:
 *   npx tsx experiments/analyze-live-run.ts
 *   npx tsx experiments/analyze-live-run.ts --run 2026-09-13T17-45-02-113Z
 *   npx tsx experiments/analyze-live-run.ts --visible experiments/logs/visible-sunday.jsonl
 *
 * The `--visible` file is JSONL, one row per play you located in the recording:
 *   { "playId": "4018726561685", "visibleAt": "13:42:07.512" }
 *   { "playId": "4018726561712", "visibleAtMs": 1789234927512 }
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, 'logs');

interface LogRow {
  wall: number;
  kind: string;
  [key: string]: unknown;
}

function readJsonl(filePath: string): LogRow[] {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogRow);
}

function num(row: LogRow, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function str(row: LogRow, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function gameClock(quarter: number | null, seconds: number | null): string {
  if (quarter === null || seconds === null) return '?';
  return `Q${quarter} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function describe(label: string, values: number[], unit = 'ms'): void {
  if (values.length === 0) {
    console.log(`  ${label}: (none)`);
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `  ${label}: n=${values.length} min=${sorted[0]}${unit} p50=${percentile(sorted, 50)}${unit} ` +
      `p95=${percentile(sorted, 95)}${unit} max=${sorted[sorted.length - 1]}${unit}`,
  );
}

function counts<T>(items: T[], keyOf: (item: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Resolves an `HH:MM:SS.mmm` string against the run's own date, so times read off the clock work. */
function resolveVisibleAt(row: LogRow, runReferenceMs: number): number | null {
  const explicit = num(row, 'visibleAtMs');
  if (explicit !== null) return explicit;

  const text = str(row, 'visibleAt');
  if (text === null) return null;
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;

  const base = new Date(runReferenceMs);
  base.setHours(Number(match[1]), Number(match[2]), Number(match[3]), Number((match[4] ?? '0').padEnd(3, '0')));
  return base.getTime();
}

function findRunId(explicit: string | undefined): string {
  const files = readdirSync(LOG_DIR).filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'));
  if (files.length === 0) throw new Error(`no events-*.jsonl in ${LOG_DIR}`);

  if (explicit) {
    if (!files.includes(`events-${explicit}.jsonl`)) {
      throw new Error(`no events-${explicit}.jsonl in ${LOG_DIR}`);
    }
    return explicit;
  }
  // Run ids are ISO timestamps, so lexical order is chronological.
  const newest = files.sort().at(-1) ?? '';
  return newest.slice('events-'.length, -'.jsonl'.length);
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const runId = findRunId(flag('run'));
  const events = readJsonl(path.join(LOG_DIR, `events-${runId}.jsonl`));
  const plays = readJsonl(path.join(LOG_DIR, `plays-${runId}.jsonl`));

  const markerFiles = readdirSync(LOG_DIR).filter((f) => f.startsWith('markers-'));
  const markers = markerFiles.flatMap((f) => readJsonl(path.join(LOG_DIR, f)));

  const runStart = plays[0]?.wall ?? events[0]?.wall ?? Date.now();
  const runEnd = plays.at(-1)?.wall ?? events.at(-1)?.wall ?? runStart;

  console.log(`\n=== run ${runId} ===`);
  console.log(
    `  ${stamp(runStart)} -> ${stamp(runEnd)}  (${((runEnd - runStart) / 60000).toFixed(1)} min)`,
  );

  // ---- feed integrity ----
  const playIds = plays.map((p) => `${str(p, 'gameId')}:${str(p, 'playId')}`);
  const gameIds = [...new Set(plays.map((p) => str(p, 'gameId') ?? '?'))];
  console.log(`\n--- feed integrity ---`);
  console.log(`  games polled: ${gameIds.length}`);
  console.log(
    `  plays: ${playIds.length}  unique: ${new Set(playIds).size}  DUPLICATES: ${playIds.length - new Set(playIds).size}`,
  );
  for (const [gameId, n] of counts(plays, (p) => str(p, 'gameId') ?? '?')) {
    console.log(`    ${gameId}: ${n} plays`);
  }

  // ---- ESPN health across N concurrent pollers ----
  const health = events.filter((e) => e.kind === 'espn_health');
  const pollFailures = events.filter((e) => e.kind === 'espn_poll_failure');
  console.log(`\n--- ESPN health (${gameIds.length} concurrent pollers) ---`);
  const totalPolls = health.reduce((sum, h) => sum + (num(h, 'polls') ?? 0), 0);
  console.log(`  polls: ${totalPolls}   failures: ${pollFailures.length}`);
  for (const [key, n] of counts(pollFailures, (e) => str(e, 'failureKind') ?? '?')) {
    console.log(`    ${n.toString().padStart(4)}  ${key}`);
  }
  describe(
    'poll latency (p50 per 60s window)',
    health.flatMap((h) => {
      const v = num(h, 'p50Ms');
      return v === null ? [] : [v];
    }),
  );
  describe(
    'poll latency (worst per 60s window)',
    health.flatMap((h) => {
      const v = num(h, 'maxMs');
      return v === null ? [] : [v];
    }),
  );

  // ---- resumption ----
  const resolved = events.filter((e) => e.kind === 'resumption_resolved');
  const opened = events.filter((e) => e.kind === 'resumption_window_opened');
  console.log(`\n--- resumption detection ---`);
  console.log(`  windows opened: ${opened.length}   resolved: ${resolved.length}`);
  for (const [key, n] of counts(resolved, (e) => `${str(e, 'outcome')} via ${str(e, 'resolvedBy')}`)) {
    console.log(`    ${n.toString().padStart(4)}  ${key}`);
  }
  console.log(`  revealing play that opened the window:`);
  for (const [key, n] of counts(
    opened,
    (e) => `${str(e, 'revealingPlayType')} (${str(e, 'revealingCategory')})`,
  )) {
    console.log(`    ${n.toString().padStart(4)}  ${key}`);
  }
  describe(
    'pause length (REAL_ACTION elapsedMs)',
    resolved.filter((e) => str(e, 'outcome') === 'REAL_ACTION').flatMap((e) => {
      const v = num(e, 'elapsedMs');
      return v === null ? [] : [v];
    }),
  );
  const ceilingByTimer = resolved.filter((e) => str(e, 'resolvedBy') === 'wall_clock_timer').length;
  console.log(
    `  ceiling fired by wall-clock timer (unreachable by the pure function): ${ceilingByTimer}`,
  );

  // ---- gating ----
  const gated = events.filter((e) => e.kind === 'gated');
  console.log(`\n--- gating ---`);
  for (const [key, n] of counts(gated, (e) => str(e, 'decision') ?? '?')) {
    console.log(`    ${n.toString().padStart(4)}  ${key}`);
  }
  describe(
    'holdMs',
    gated.flatMap((e) => {
      const v = num(e, 'holdMs');
      return v === null ? [] : [v];
    }),
  );
  const withResumption = gated.filter((e) => str(e, 'resumptionOutcome') !== null);
  console.log(
    `  events tied to a possession change: ${withResumption.length} of ${gated.length}` +
      ` (the rest are unitOnField churn — punts, penalties, period ends)`,
  );
  for (const [key, n] of counts(gated, (e) => str(e, 'eventType') ?? '?')) {
    console.log(`    ${n.toString().padStart(4)}  ${key}`);
  }

  // ---- delivery ----
  const delivered = events.filter((e) => e.kind === 'delivered');
  const pushes = events.filter((e) => e.kind === 'push');
  const rateLimited = events.filter((e) => e.kind === 'rate_limit_would_drop');
  console.log(`\n--- delivery ---`);
  console.log(
    `  delivered: ${delivered.length}   push attempts: ${pushes.length}   ` +
      `push ok: ${pushes.filter((p) => p['success'] === true).length}`,
  );
  for (const [key, n] of counts(
    pushes.filter((p) => p['success'] !== true),
    (p) => str(p, 'error') ?? 'unknown',
  )) {
    console.log(`    push FAILED ${n}x: ${key}`);
  }
  describe(
    'queue latency (deliveredAt - firedAt)',
    delivered.flatMap((e) => {
      const d = num(e, 'deliveredAt');
      const f = num(e, 'firedAt');
      return d === null || f === null ? [] : [d - f];
    }),
  );
  console.log(
    `  notifications the REAL 3/60s limit would have dropped: ${rateLimited.length}` +
      ` of ${delivered.length} delivered`,
  );

  // ---- ground truth join ----
  const deliveredAtByEvent = new Map<string, number>();
  for (const row of delivered) {
    const id = str(row, 'eventId');
    const at = num(row, 'deliveredAt');
    if (id && at !== null) deliveredAtByEvent.set(id, at);
  }
  const playById = new Map<string, LogRow>();
  for (const p of plays) {
    const id = str(p, 'playId');
    if (id) playById.set(id, p);
  }

  interface Candidate {
    eventId: string;
    gameId: string;
    triggerPlayId: string;
    deliveredAt: number;
    fingerprint: string;
  }
  const candidates: Candidate[] = [];
  for (const row of gated) {
    const eventId = str(row, 'eventId');
    const triggerPlayId = str(row, 'triggerPlayId');
    if (!eventId || !triggerPlayId) continue;
    const deliveredAt = deliveredAtByEvent.get(eventId);
    if (deliveredAt === undefined) continue;
    const play = playById.get(triggerPlayId);
    candidates.push({
      eventId,
      gameId: str(row, 'gameId') ?? '?',
      triggerPlayId,
      deliveredAt,
      fingerprint: play
        ? `${gameClock(num(play, 'quarter'), num(play, 'secondsRemainingInQuarter'))} ` +
          `${str(play, 'playType')} ${num(play, 'down') ?? '-'}&${num(play, 'distance') ?? '-'} ` +
          `@${num(play, 'yardsToOpponentEndzone') ?? '-'} ` +
          `${str(play, 'away')} ${num(play, 'scoreAway')}-${num(play, 'scoreHome')} ${str(play, 'home')}`
        : '(play not in log)',
    });
  }

  const visiblePath = flag('visible');
  if (!visiblePath) {
    console.log(`\n--- WORKSHEET: ${candidates.length} possession-change notification(s) to locate ---`);
    console.log(`  Scrub the recording to each play, read the reference clock, and write a JSONL file:`);
    console.log(`    { "playId": "<triggerPlayId>", "visibleAt": "HH:MM:SS.mmm" }`);
    console.log(`  Then: npx tsx experiments/analyze-live-run.ts --visible <that file>\n`);
    for (const c of candidates) {
      console.log(
        `  delivered ${stamp(c.deliveredAt)}  game ${c.gameId}  trigger ${c.triggerPlayId}\n` +
          `      ${c.fingerprint}`,
      );
    }
  } else {
    const visibleRows = readJsonl(path.resolve(visiblePath));
    const visibleByPlay = new Map<string, number>();
    for (const row of visibleRows) {
      const playId = str(row, 'playId');
      const at = resolveVisibleAt(row, runStart);
      if (playId && at !== null) visibleByPlay.set(playId, at);
    }

    console.log(`\n--- SIGNED GAPS (recording, primary channel) ---`);
    console.log(`  gap = deliveredAt - broadcastVisibleAt.  positive = safe, NEGATIVE = SPOILER\n`);
    const gaps: number[] = [];
    let spoilers = 0;
    for (const c of candidates) {
      const visibleAt = visibleByPlay.get(c.triggerPlayId);
      if (visibleAt === undefined) {
        console.log(`  ${c.triggerPlayId}  (no recording time supplied)`);
        continue;
      }
      const gap = c.deliveredAt - visibleAt;
      gaps.push(gap);
      if (gap < 0) spoilers += 1;
      console.log(
        `  ${c.triggerPlayId}  visible ${stamp(visibleAt)}  delivered ${stamp(c.deliveredAt)}  ` +
          `gap ${gap >= 0 ? '+' : ''}${(gap / 1000).toFixed(2)}s${gap < 0 ? '   <-- SPOILER' : ''}`,
      );
    }
    describe('gap', gaps);
    console.log(
      `\n  ZERO-SPOILER CRITERION: ${spoilers === 0 ? 'PASS' : `FAIL (${spoilers} spoiler(s))`}` +
        `  [${gaps.length} of ${candidates.length} events measured]`,
    );
  }

  // ---- keypress channel ----
  if (markers.length > 0) {
    console.log(`\n--- keypress markers (redundant channel, carries reaction lag) ---`);
    console.log(`  ${markers.length} marker(s) across ${markerFiles.length} file(s)`);
    const NEAR_MS = 60_000;
    for (const c of candidates) {
      let best: LogRow | null = null;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (const m of markers) {
        const delta = Math.abs(m.wall - c.deliveredAt);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = m;
        }
      }
      if (best && bestDelta <= NEAR_MS) {
        const gap = c.deliveredAt - best.wall;
        console.log(
          `  ${c.triggerPlayId}  nearest marker #${num(best, 'index') ?? '?'} ` +
            `${str(best, 'note') ?? ''} gap ${gap >= 0 ? '+' : ''}${(gap / 1000).toFixed(2)}s`,
        );
      }
    }
  }

  console.log('');
}

main();
