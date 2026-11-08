/**
 * EXPERIMENT (issue #6, R1) — not production code.
 *
 * Replays every game under `experiments/logs/recordings/` and reports, per possession change, when
 * the nudge goes out today versus on the possession-ending play (`end.team`). Also compares the
 * recorded 60s scoreboard polls against the 5s summary polls. Prints markdown to stdout.
 *
 *   pnpm build   # @pivot/* resolve to dist at runtime
 *   npx tsx experiments/replay-early-nudge.ts [recordingsRoot] [--detail]
 *
 * Findings: docs/R1-EARLY-NUDGE-FINDINGS.md.
 */

import { gunzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TeamId } from '@pivot/engine';
import { espnSummarySchema, mapEspnPlay, resolveGameContext } from '@pivot/ingestion';
import {
  buildArrivals,
  compareScoreboard,
  detectEarly,
  pairChanges,
  percentile,
  simulateToday,
  STALE_FEED_MS,
  type Arrival,
  type EndingKind,
  type PlayHistory,
  type PossessionChange,
  type ScoreboardSample,
  type Snapshot,
  type SnapshotPlay,
} from './earlyNudge.js';

/** Same override as `mapEspnPlay`, so `end.team` lands in the `PlayEvent` team id space. */
const ABBREVIATION_OVERRIDES: Readonly<Record<string, string>> = { WSH: 'WAS' };

// Raw ESPN JSON: `espnSummarySchema` strips `end`, which is the field under test.
/* eslint-disable @typescript-eslint/no-explicit-any -- raw, unvalidated ESPN JSON */
type Raw = any;

function teamMap(competitors: Raw[] | undefined): Map<string, TeamId> {
  const map = new Map<string, TeamId>();
  for (const c of competitors ?? []) {
    const id = c?.team?.id ?? c?.id;
    const abbr = c?.team?.abbreviation;
    if (id !== undefined && abbr !== undefined) {
      map.set(String(id), ABBREVIATION_OVERRIDES[abbr] ?? abbr);
    }
  }
  return map;
}

function rawFlatten(raw: Raw): { play: Raw; drive: Raw }[] {
  const out: { play: Raw; drive: Raw }[] = [];
  for (const drive of raw?.drives?.previous ?? []) {
    for (const play of drive?.plays ?? []) out.push({ play, drive });
  }
  const current = raw?.drives?.current;
  for (const play of current?.plays ?? []) out.push({ play, drive: current });
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function gz(file: string): Promise<Raw> {
  return JSON.parse(gunzipSync(await readFile(file)).toString('utf8')) as Raw;
}

function receivedAt(file: string): number {
  return Date.parse(path.basename(file).replace(/\.json\.gz$/, ''));
}

/** A summary poll gap longer than this means the recorder was down; the next snapshot is backfill. */
const MAX_POLL_GAP_MS = 30_000;

/**
 * Successful summary poll times per game from the recorder's index, including polls that saw no
 * change. Failed polls (`status: "error"`, e.g. the Mac lost network) are not polls for this purpose.
 */
async function loadPollTimes(dateDir: string): Promise<Map<string, number[]>> {
  const polls = new Map<string, number[]>();
  let body: string;
  try {
    body = await readFile(path.join(dateDir, 'index.jsonl'), 'utf8');
  } catch {
    return polls;
  }
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue;
    let entry: { kind?: string; eventId?: string; receivedAt?: string; status?: string };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (
      entry.kind !== 'summary' ||
      entry.status === 'error' ||
      !entry.eventId ||
      !entry.receivedAt
    ) {
      continue;
    }
    const list = polls.get(entry.eventId) ?? [];
    list.push(Date.parse(entry.receivedAt));
    polls.set(entry.eventId, list);
  }
  for (const list of polls.values()) list.sort((a, b) => a - b);
  return polls;
}

/** True when the poll before `atMs` is more than `MAX_POLL_GAP_MS` earlier (or there is none). */
function followsGap(pollTimes: readonly number[], atMs: number): boolean {
  let previous: number | null = null;
  for (const t of pollTimes) {
    if (t >= atMs - 500) break;
    previous = t;
  }
  return previous === null || atMs - previous > MAX_POLL_GAP_MS;
}

async function loadGame(
  dir: string,
  gameId: string,
  pollTimes: readonly number[],
): Promise<Snapshot[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json.gz')).sort();
  const snapshots: Snapshot[] = [];
  for (const file of files) {
    const raw = await gz(path.join(dir, file));
    const parsed = espnSummarySchema.safeParse(raw);
    if (!parsed.success) continue;
    const context = resolveGameContext(parsed.data, gameId);
    if (!context) continue;
    const teams = teamMap(raw?.header?.competitions?.[0]?.competitors);
    const rawById = new Map(rawFlatten(raw).map((entry) => [String(entry.play.id), entry]));

    const plays: SnapshotPlay[] = [];
    const seen = new Set<string>();
    const drives = [
      ...(parsed.data.drives?.previous ?? []),
      ...(parsed.data.drives?.current ? [parsed.data.drives.current] : []),
    ];
    for (const drive of drives) {
      for (const play of drive.plays ?? []) {
        if (seen.has(play.id)) continue;
        seen.add(play.id);
        const rawEntry = rawById.get(play.id);
        const endId = rawEntry?.play?.end?.team?.id;
        plays.push({
          event: mapEspnPlay(play, drive, context, false),
          endTeamId: endId === undefined ? null : (teams.get(String(endId)) ?? null),
          typeText: String(rawEntry?.play?.type?.text ?? ''),
          text: String(rawEntry?.play?.text ?? ''),
          driveResult: rawEntry?.drive?.displayResult ?? null,
        });
      }
    }
    const at = receivedAt(file);
    snapshots.push({
      receivedAtMs: at,
      plays,
      afterGap: snapshots.length > 0 && followsGap(pollTimes, at),
    });
  }
  return snapshots;
}

async function loadScoreboard(
  dir: string,
  gameIds: ReadonlySet<string>,
): Promise<ScoreboardSample[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json.gz')).sort();
  } catch {
    return [];
  }
  const samples: ScoreboardSample[] = [];
  for (const file of files) {
    const raw = await gz(path.join(dir, file));
    for (const event of raw?.events ?? []) {
      const gameId = String(event?.id);
      if (!gameIds.has(gameId)) continue;
      const competition = event?.competitions?.[0];
      if (competition?.status?.type?.state !== 'in') continue;
      const situation = competition?.situation;
      const teams = teamMap(competition?.competitors);
      const possession = situation?.possession;
      samples.push({
        atMs: receivedAt(file),
        gameId,
        lastPlayId: situation?.lastPlay?.id ? String(situation.lastPlay.id) : null,
        possession: possession === undefined ? null : (teams.get(String(possession)) ?? null),
      });
    }
  }
  return samples;
}

const s = (ms: number | null): string => (ms === null ? '–' : (ms / 1000).toFixed(1));

function row(label: string, values: readonly number[]): string {
  return `| ${label} | ${values.length} | ${s(percentile(values, 0.5))} | ${s(percentile(values, 0.1))} | ${s(percentile(values, 0.9))} |`;
}

const KINDS: readonly EndingKind[] = [
  'punt',
  'kickoff_after_score',
  'turnover',
  'turnover_on_downs',
  'missed_fg',
  'end_of_half',
  'return_td',
  'safety',
  'other',
];

interface GameReplay {
  date: string;
  gameId: string;
  snapshots: number;
  arrivals: Arrival[];
  history: Map<string, PlayHistory>;
  changes: PossessionChange[];
  unmatchedEarly: ReturnType<typeof pairChanges>['unmatchedEarly'];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const detail = args.includes('--detail');
  const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'experiments/logs/recordings');

  const games: GameReplay[] = [];
  const skipped: string[] = [];
  const samples: ScoreboardSample[] = [];
  for (const date of (await readdir(root)).sort()) {
    const dateDir = path.join(root, date);
    if (!(await stat(dateDir)).isDirectory()) continue;
    const gameIds = (await readdir(dateDir)).filter((d) => /^\d+$/.test(d)).sort();
    const pollTimes = await loadPollTimes(dateDir);
    for (const gameId of gameIds) {
      const snapshots = await loadGame(
        path.join(dateDir, gameId),
        gameId,
        pollTimes.get(gameId) ?? [],
      );
      const { arrivals, history } = buildArrivals(snapshots);
      if (arrivals.every((a) => a.backfilled)) {
        skipped.push(`${date}/${gameId} (${snapshots.length} snapshots, no live arrivals)`);
        continue;
      }
      const today = await simulateToday(gameId, arrivals);
      const { changes, unmatchedEarly } = pairChanges(
        arrivals,
        history,
        today,
        detectEarly(arrivals),
      );
      games.push({
        date,
        gameId,
        snapshots: snapshots.length,
        arrivals,
        history,
        changes,
        unmatchedEarly,
      });
    }
    // A scoreboard poll is only comparable while the summary poller was working for that game.
    const boards = await loadScoreboard(path.join(dateDir, 'scoreboard'), new Set(gameIds));
    samples.push(
      ...boards.filter((b) => !followsGap(pollTimes.get(b.gameId) ?? [], b.atMs + 1000)),
    );
  }

  const out: string[] = [];
  out.push('# R1 early-nudge replay', '');
  out.push(
    '## Games',
    '',
    '| game | snapshots | live arrivals | backfilled | changes |',
    '|---|---|---|---|---|',
  );
  for (const g of games) {
    const live = g.arrivals.filter((a) => !a.backfilled).length;
    out.push(
      `| ${g.date}/${g.gameId} | ${g.snapshots} | ${live} | ${g.arrivals.length - live} | ${g.changes.length} |`,
    );
  }
  if (skipped.length > 0) out.push('', `Skipped: ${skipped.join('; ')}`);

  const live = games.flatMap((g) => g.arrivals.filter((a) => !a.backfilled && !a.staleFeed));
  const stalled = games.flatMap((g) => g.arrivals.filter((a) => !a.backfilled && a.staleFeed));
  out.push(
    '',
    `Late arrivals not explained by a recorder gap (first seen > ${STALE_FEED_MS / 60_000} min after wallclock): ${stalled.length} plays in ${new Set(stalled.map((a) => a.event.gameId)).size} games (${[...new Set(stalled.map((a) => a.event.gameId))].join(', ')}). Excluded below.`,
  );
  const publishLag = live.flatMap((a) =>
    a.wallclockMs === null ? [] : [a.seenAtMs - a.wallclockMs],
  );
  out.push(
    '',
    '## Publish lag (seenAt − wallclock), live arrivals',
    '',
    '| | n | median s | p10 s | p90 s |',
    '|---|---|---|---|---|',
  );
  out.push(row('all plays', publishLag));

  const changes = games.flatMap((g) => g.changes.filter((c) => !c.backfilled && !c.stale));
  const staleChanges = games.flatMap((g) => g.changes.filter((c) => !c.backfilled && c.stale));
  const measured = changes.filter((c) => c.gainMs !== null);
  out.push(
    '',
    '## Seconds gained (today push − early nudge)',
    '',
    '| ending | n | median s | p10 s | p90 s |',
    '|---|---|---|---|---|',
  );
  out.push(
    row(
      '**all**',
      measured.map((c) => c.gainMs as number),
    ),
  );
  for (const kind of KINDS) {
    const values = measured.filter((c) => c.kind === kind).map((c) => c.gainMs as number);
    if (values.length > 0) out.push(row(kind, values));
  }

  out.push(
    '',
    '## Seconds gained against a gate that always pushes on the first snap',
    '',
    '| ending | n | median s | p10 s | p90 s |',
    '|---|---|---|---|---|',
  );
  out.push(
    row(
      '**all**',
      measured.map((c) => c.gainVsFirstSnapMs as number),
    ),
  );
  for (const kind of KINDS) {
    const values = measured
      .filter((c) => c.kind === kind)
      .map((c) => c.gainVsFirstSnapMs as number);
    if (values.length > 0) out.push(row(kind, values));
  }

  out.push(
    '',
    '## Push time after the possession-ending play (push − its wallclock)',
    '',
    '| model | n | median s | p10 s | p90 s |',
    '|---|---|---|---|---|',
  );
  const withWall = measured.filter((c) => c.endingWallclockMs !== null);
  out.push(
    row(
      'today',
      withWall.map((c) => (c.today?.pushAtMs as number) - (c.endingWallclockMs as number)),
    ),
  );
  out.push(
    row(
      'early',
      withWall.map((c) => (c.early?.seenAtMs as number) - (c.endingWallclockMs as number)),
    ),
  );
  for (const kind of KINDS) {
    const subset = withWall.filter((c) => c.kind === kind);
    if (subset.length === 0) continue;
    out.push(
      row(
        `today: ${kind}`,
        subset.map((c) => (c.today?.pushAtMs as number) - (c.endingWallclockMs as number)),
      ),
    );
    out.push(
      row(
        `early: ${kind}`,
        subset.map((c) => (c.early?.seenAtMs as number) - (c.endingWallclockMs as number)),
      ),
    );
  }

  const count = (pred: (c: PossessionChange) => boolean): number => changes.filter(pred).length;
  out.push('', '## Change accounting (live, non-backfilled)', '');
  out.push(`- changes excluded for a feed stall: ${staleChanges.length}`);
  out.push(`- changes seen by today's tracker: ${changes.length}`);
  out.push(`- measured (both sides fire): ${measured.length}`);
  out.push(
    `- today never pushes (window aborted): ${count((c) => c.window.outcome === 'ABORTED')}`,
  );
  out.push(
    `- today never pushes (no offense snap before next change): ${count((c) => c.window.outcome !== 'ABORTED' && c.today === null)}`,
  );
  out.push(`- no early nudge matched: ${count((c) => c.early === null)}`);
  out.push(
    `- early nudge from drive fallback (end missing): ${count((c) => c.early?.source === 'drive_fallback')}`,
  );
  out.push(
    `- early nudge not faster (gain ≤ 0): ${count((c) => c.gainMs !== null && c.gainMs <= 0)}`,
  );
  const decisions = new Map<string, number>();
  for (const c of changes) {
    const decision = c.today
      ? `${c.today.decision} / resolution=${c.today.resolution ?? 'none'}`
      : 'no push';
    const key = `${c.kind} (${c.precedingResult ?? '?'}): ${decision}`;
    decisions.set(key, (decisions.get(key) ?? 0) + 1);
  }
  out.push('', "Today's gate decision for the pushed flag:", '');
  for (const [key, n] of [...decisions].sort((a, b) => b[1] - a[1])) out.push(`- ${key}: ${n}`);

  // Edge cases.
  const allLive = games.flatMap((g) =>
    g.arrivals.filter((a) => !a.backfilled).map((a) => ({ g, a })),
  );
  const nonProcedural = allLive.filter(({ a }) => a.event.possessionTeamId !== null);
  const revised = games.flatMap((g) =>
    [...g.history]
      .filter(([, h]) => h.endTeams.length > 1 || h.final === null)
      .map(([id, h]) => ({ g, id, h })),
  );
  const unmatched = games.flatMap((g) =>
    g.unmatchedEarly.map((n) => ({ g, n, a: g.arrivals[n.index] })),
  );
  out.push('', '## Edge cases', '');
  out.push(
    `- live non-procedural plays: ${nonProcedural.length}; missing end.team: ${nonProcedural.filter(({ a }) => a.endTeamId === null).length}; missing wallclock (all live plays): ${allLive.filter(({ a }) => a.wallclockMs === null).length}`,
  );
  out.push(
    `- plays whose end.team changed across snapshots: ${revised.filter(({ h }) => h.endTeams.length > 1).length}; plays later deleted: ${revised.filter(({ h }) => h.final === null).length}`,
  );
  const reviewed = games.flatMap((g) =>
    [...g.history]
      .filter(([, h]) => h.final && /reversed|overturned|upheld|challenged/i.test(h.final.text))
      .map(([id, h]) => ({ g, id, h })),
  );
  out.push(
    `- plays mentioning a review (reversed/overturned/upheld/challenged): ${reviewed.length}`,
  );
  for (const { g, id, h } of reviewed) {
    out.push(
      `  - ${g.gameId}/${id} end.team history ${JSON.stringify(h.endTeams)}: ${h.final?.text.slice(0, 160)}`,
    );
  }
  const textual = (re: RegExp) => allLive.filter(({ a }) => re.test(a.text) || re.test(a.typeText));
  out.push(`- onside kicks: ${textual(/onside/i).length}`);
  for (const { g, a } of textual(/onside/i))
    out.push(
      `  - ${g.gameId}/${a.event.playId} end=${a.endTeamId} drive=${a.event.possessionTeamId}: ${a.text.slice(0, 160)}`,
    );
  out.push(`- muffed punts/kicks: ${textual(/muff/i).length}`);
  for (const { g, a } of textual(/muff/i))
    out.push(
      `  - ${g.gameId}/${a.event.playId} end=${a.endTeamId} drive=${a.event.possessionTeamId}: ${a.text.slice(0, 160)}`,
    );
  out.push(`- safeties: ${textual(/safety/i).length}`);
  for (const { g, a } of textual(/safety/i))
    out.push(`  - ${g.gameId}/${a.event.playId} end=${a.endTeamId}: ${a.text.slice(0, 160)}`);

  out.push('', `### Early nudges with no matching change today (${unmatched.length})`, '');
  for (const { g, n, a } of unmatched) {
    const h = g.history.get(a.event.playId);
    out.push(
      `- ${g.gameId}/${a.event.playId}${a.backfilled ? ' (backfilled)' : ''} ${n.from}→${n.team} [${a.typeText}] end.team history ${JSON.stringify(h?.endTeams)}: ${a.text.slice(0, 140)}`,
    );
  }
  out.push('', '### Plays whose end.team changed or that were deleted', '');
  for (const { g, id, h } of revised) {
    const a = g.arrivals.find((x) => x.event.playId === id);
    out.push(
      `- ${g.gameId}/${id} ${JSON.stringify(h.endTeams)}${h.final === null ? ' DELETED' : ''} [${a?.typeText}] ${(h.final ?? a)?.text.slice(0, 120)}`,
    );
  }

  // Scoreboard vs summary.
  const arrivalsByGame = new Map(games.map((g) => [g.gameId, g.arrivals]));
  const comparisons = compareScoreboard(samples, arrivalsByGame).filter(
    (c) => c.sample.lastPlayId !== null,
  );
  out.push('', '## Scoreboard (60s polls) vs summary (5s polls)', '');
  out.push(
    `- in-progress scoreboard samples with lastPlay: ${comparisons.length}; lastPlay never in summary: ${comparisons.filter((c) => c.leadMs === null).length}`,
  );
  const ahead = comparisons.filter((c) => c.leadMs !== null && c.leadMs > 0);
  const stale = comparisons.filter((c) => c.staleMs !== null);
  const level = comparisons.filter((c) => c.leadMs !== null && c.leadMs <= 0 && c.staleMs === null);
  out.push(
    `- scoreboard ahead (its lastPlay not yet in any summary): ${ahead.length}; level (same latest play): ${level.length}; stale (summary already had a later play): ${stale.length}`,
  );
  out.push('', '| | n | median s | p10 s | p90 s |', '|---|---|---|---|---|');
  out.push(
    row(
      'lead when ahead (summary seenAt − scoreboard poll)',
      ahead.map((c) => c.leadMs as number),
    ),
  );
  out.push(
    row(
      'staleness when stale (poll − summary seenAt of next play)',
      stale.map((c) => c.staleMs as number),
    ),
  );
  const possessionSamples = comparisons.filter(
    (c) => c.sample.possession !== null && c.summaryBall !== null,
  );
  const disagree = possessionSamples.filter((c) => c.sample.possession !== c.summaryBall);
  out.push('', `- possession compared: ${possessionSamples.length}; disagree: ${disagree.length}`);
  for (const c of disagree) {
    out.push(
      `  - ${c.sample.gameId} @${new Date(c.sample.atMs).toISOString()} scoreboard=${c.sample.possession} summary=${c.summaryBall} lead=${s(c.leadMs)}s stale=${s(c.staleMs)}s`,
    );
  }

  if (detail) {
    out.push(
      '',
      '## Detail',
      '',
      '| game | kind | from→to | today decision | gain s | early play | plays from preceding to push |',
      '|---|---|---|---|---|---|---|',
    );
    for (const g of games) {
      for (const c of g.changes) {
        const a = c.early ? g.arrivals[c.early.index] : null;
        const last = c.today?.dispatchIndex ?? c.window.openedIndex;
        const sequence = g.arrivals
          .slice(c.window.precedingIndex, last + 1)
          .map((x) => x.event.playType)
          .join(' → ');
        out.push(
          `| ${g.gameId} | ${c.kind}${c.backfilled ? ' (bf)' : ''}${c.stale ? ' (stale)' : ''} | ${c.window.from}→${c.window.to} | ${c.today?.decision ?? c.window.outcome} | ${s(c.gainMs)} | ${a ? `${a.typeText}: ${a.text.slice(0, 60)}` : '–'} | ${sequence} |`,
        );
      }
    }
  }

  console.log(out.join('\n'));
}

void main();
