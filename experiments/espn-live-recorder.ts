/**
 * THROWAWAY — not part of the Pivot app, not production code.
 *
 * Records raw ESPN scoreboard and game-summary responses during a live slate so a later
 * offline run can feed those bytes through `espnClient` / `mapEspnPlay`.
 *
 * Scoreboard: once at startup, then every 60s.
 * Summaries: every game that is in progress, or within 15 minutes of kickoff, at the same
 * 5s default `EspnPlaySource` uses. `--event <id>` records that game even if it is already
 * final (tonight's dry run). A game stops after ESPN reports it final and one more poll has
 * been saved. The process exits when every game of the day is final, or on SIGINT/SIGTERM
 * after in-flight writes finish.
 *
 * Each fetch has a 10s timeout. A failure is logged and indexed; it does not stop other games.
 *
 *   npx tsx experiments/espn-live-recorder.ts
 *   npx tsx experiments/espn-live-recorder.ts --event 401872948
 *
 * Files (under experiments/logs/, which is gitignored):
 *   recordings/<YYYY-MM-DD>/<eventId>/<receivedAtISO>.json.gz
 *   recordings/<YYYY-MM-DD>/index.jsonl
 *   recordings/status.json
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same endpoints `espnClient` calls. Kept here so this script does not import the client. */
const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const SCOREBOARD_URL = `${BASE_URL}/scoreboard`;
const summaryUrl = (eventId: string): string => `${BASE_URL}/summary?event=${eventId}`;

/** `EspnPlaySource`'s default (`services/ingestion/src/espn/espnPlaySource.ts`). */
const SUMMARY_INTERVAL_MS = 5000;
const SCOREBOARD_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const KICKOFF_WINDOW_MS = 15 * 60 * 1000;
const SCOREBOARD_EVENT_ID = 'scoreboard';
const NY_TIME_ZONE = 'America/New_York';

const RECORDINGS_ROOT = path.resolve(__dirname, 'logs/recordings');
const PID_FILE = path.join(RECORDINGS_ROOT, 'recorder.pid');
const STATUS_FILE = path.join(RECORDINGS_ROOT, 'status.json');

type GamePhase = 'idle' | 'polling' | 'extra' | 'done';
type PollKind = 'summary' | 'scoreboard';

interface TrackedGame {
  eventId: string;
  away: string;
  home: string;
  state: string;
  completed: boolean;
  kickoffMs: number | null;
  phase: GamePhase;
  nextDue: number;
  inFlight: boolean;
  lastHash: string | null;
  hashLoaded: boolean;
}

interface PollIndexLine {
  receivedAt: string;
  eventId: string;
  kind: PollKind;
  status: string;
  playCount: number;
  bytes: number;
  changed: boolean;
  error?: string;
}

interface FetchOk {
  ok: true;
  status: number;
  body: Buffer;
}

interface FetchFail {
  ok: false;
  status: number;
  error: string;
}

type FetchOutcome = FetchOk | FetchFail;

interface SummaryMeta {
  state: string;
  playCount: number;
  final: boolean;
  home: string | null;
  away: string | null;
}

const games = new Map<string, TrackedGame>();
let forcedEventId: string | null = null;
let outputDir = RECORDINGS_ROOT;
let indexPath = path.join(RECORDINGS_ROOT, 'index.jsonl');
let stopRequested = false;
let signalCount = 0;
let lastSuccessfulPollAt: string | null = null;
let scoreboardNextDue = 0;
let scoreboardInFlight = false;
let scoreboardHash: string | null = null;
let scoreboardHashLoaded = false;
let persistChain: Promise<void> = Promise.resolve();
const inflight = new Set<Promise<void>>();
let wakeSleep: (() => void) | null = null;

function message(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'timeout after 10s';
  return error instanceof Error ? error.message : String(error);
}

function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function hashBody(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nudge(): void {
  const wake = wakeSleep;
  wakeSleep = null;
  wake?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (wakeSleep === finish) wakeSleep = null;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    wakeSleep = finish;
  });
}

function installSignals(): void {
  // Node resets SIGHUP to "terminate" on startup, which undoes nohup. Ignore it so closing
  // the terminal does not kill a detached recorder. SIGINT/SIGTERM still flush and exit.
  process.on('SIGHUP', () => undefined);
  const onSignal = (name: string): void => {
    signalCount += 1;
    if (signalCount >= 2) {
      console.error('[recorder] second signal, exiting now');
      process.exit(1);
    }
    stopRequested = true;
    console.log(`[recorder] ${name}, flushing`);
    nudge();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

function parseArgs(argv: readonly string[]): void {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg !== '--event') throw new Error(`unknown argument: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('--event requires an ESPN event id');
    }
    if (!/^[A-Za-z0-9]+$/.test(value)) {
      throw new Error('--event must be an ESPN event id');
    }
    forcedEventId = value;
    i += 1;
  }
}

function isGameFinal(game: TrackedGame): boolean {
  return game.completed || game.state === 'post';
}

function shouldPoll(game: TrackedGame, now: number): boolean {
  if (forcedEventId !== null && game.eventId !== forcedEventId) return false;
  if (game.phase === 'done') return false;
  if (game.phase === 'polling' || game.phase === 'extra') return true;
  if (forcedEventId !== null && game.eventId === forcedEventId) return true;
  if (isGameFinal(game)) return false;
  if (game.state === 'in') return true;
  if (game.kickoffMs === null) return false;
  return now >= game.kickoffMs - KICKOFF_WINDOW_MS;
}

function allRelevantSettled(): boolean {
  const relevant = [...games.values()].filter((game) =>
    forcedEventId === null ? true : game.eventId === forcedEventId,
  );
  if (relevant.length === 0) return false;
  return relevant.every((game) => {
    if (game.phase === 'done') return true;
    if (game.phase === 'polling' || game.phase === 'extra') return false;
    if (forcedEventId !== null) return false;
    return isGameFinal(game);
  });
}

function recordingIds(): string[] {
  return [...games.values()]
    .filter((game) => game.phase === 'polling' || game.phase === 'extra')
    .map((game) => game.eventId)
    .sort();
}

function readStatusType(rec: Record<string, unknown> | null): {
  state: string;
  completed: boolean;
} {
  const type = asRecord(rec?.['type']);
  const state = typeof type?.['state'] === 'string' ? type['state'] : 'unknown';
  return { state, completed: type?.['completed'] === true };
}

function readCompetitors(container: Record<string, unknown> | null): {
  home: string | null;
  away: string | null;
} {
  const competitors = container?.['competitors'];
  let home: string | null = null;
  let away: string | null = null;
  if (!Array.isArray(competitors)) return { home, away };
  for (const entry of competitors) {
    const row = asRecord(entry);
    const abbr = asRecord(row?.['team'])?.['abbreviation'];
    if (typeof abbr !== 'string') continue;
    if (row?.['homeAway'] === 'home') home = abbr;
    if (row?.['homeAway'] === 'away') away = abbr;
  }
  return { home, away };
}

function blankGame(eventId: string): TrackedGame {
  return {
    eventId,
    away: '??',
    home: '??',
    state: 'unknown',
    completed: false,
    kickoffMs: null,
    phase: 'idle',
    nextDue: 0,
    inFlight: false,
    lastHash: null,
    hashLoaded: false,
  };
}

function upsertListed(listed: {
  eventId: string;
  away: string;
  home: string;
  state: string;
  completed: boolean;
  kickoffMs: number | null;
}): void {
  const existing = games.get(listed.eventId);
  if (!existing) {
    games.set(listed.eventId, { ...blankGame(listed.eventId), ...listed });
    return;
  }
  existing.away = listed.away;
  existing.home = listed.home;
  existing.state = listed.state;
  existing.completed = listed.completed;
  existing.kickoffMs = listed.kickoffMs;
}

function ensureForced(): void {
  if (forcedEventId === null || games.has(forcedEventId)) return;
  games.set(forcedEventId, blankGame(forcedEventId));
}

function parseScoreboard(json: unknown): void {
  const events = asRecord(json)?.['events'];
  if (!Array.isArray(events)) return;
  for (const event of events) {
    const rec = asRecord(event);
    const eventId = rec?.['id'];
    if (!rec || typeof eventId !== 'string') continue;
    const competitions = rec['competitions'];
    const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
    const teams = readCompetitors(competition);
    const status = readStatusType(asRecord(rec['status']) ?? asRecord(competition?.['status']));
    const date = rec['date'];
    const kickoffMs = typeof date === 'string' ? Date.parse(date) : Number.NaN;
    upsertListed({
      eventId,
      away: teams.away ?? '??',
      home: teams.home ?? '??',
      state: status.state,
      completed: status.completed,
      kickoffMs: Number.isNaN(kickoffMs) ? null : kickoffMs,
    });
  }
}

function inspectSummary(json: unknown): SummaryMeta | null {
  const root = asRecord(json);
  const header = asRecord(root?.['header']);
  const competitions = header?.['competitions'];
  const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
  if (!competition) return null;
  const status = readStatusType(asRecord(competition['status']));
  const teams = readCompetitors(competition);
  const drives = asRecord(root?.['drives']);
  let playCount = 0;
  const previous = drives?.['previous'];
  if (Array.isArray(previous)) {
    for (const drive of previous) {
      const plays = asRecord(drive)?.['plays'];
      if (Array.isArray(plays)) playCount += plays.length;
    }
  }
  const currentPlays = asRecord(drives?.['current'])?.['plays'];
  if (Array.isArray(currentPlays)) playCount += currentPlays.length;
  return {
    state: status.state,
    playCount,
    final: status.completed || status.state === 'post',
    home: teams.home,
    away: teams.away,
  };
}

function countPlays(meta: SummaryMeta | null): number {
  return meta?.playCount ?? 0;
}

async function latestBodyHash(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const files = names.filter((name) => name.endsWith('.json.gz')).sort();
  const latest = files.at(-1);
  if (latest === undefined) return null;
  const raw = gunzipSync(await readFile(path.join(dir, latest)));
  return hashBody(raw);
}

async function writeGzip(dir: string, receivedAt: string, body: Buffer): Promise<void> {
  await mkdir(dir, { recursive: true });
  const gz = await gzipAsync(body);
  const target = path.join(dir, `${receivedAt}.json.gz`);
  try {
    await writeFile(target, gz, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await writeFile(path.join(dir, `${receivedAt}-${process.pid}.json.gz`), gz, { flag: 'wx' });
  }
}

function persist(task: () => Promise<void>): Promise<void> {
  const run = persistChain.then(task, task);
  persistChain = run.then(
    () => undefined,
    (error: unknown) => {
      console.error(`[recorder] write failed: ${message(error)}`);
    },
  );
  return run;
}

async function appendIndex(line: PollIndexLine): Promise<void> {
  await appendFile(indexPath, `${JSON.stringify(line)}\n`, 'utf8');
}

async function writeStatusFile(): Promise<void> {
  const payload = {
    outputDir,
    gamesRecording: recordingIds(),
    lastSuccessfulPollAt,
  };
  const tmp = `${STATUS_FILE}.${process.pid}.tmp`;
  await mkdir(RECORDINGS_ROOT, { recursive: true });
  await writeFile(tmp, `${JSON.stringify(payload)}\n`);
  await rename(tmp, STATUS_FILE);
}

function markSuccess(receivedAt: string): void {
  if (lastSuccessfulPollAt === null || receivedAt > lastSuccessfulPollAt) {
    lastSuccessfulPollAt = receivedAt;
  }
}

async function fetchRaw(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }
    const body = Buffer.from(await response.arrayBuffer());
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: message(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function recordPoll(line: PollIndexLine, success: boolean): Promise<void> {
  await persist(async () => {
    await appendIndex(line);
    if (success) markSuccess(line.receivedAt);
    await writeStatusFile();
  });
}

async function pollScoreboard(): Promise<void> {
  const receivedAt = new Date().toISOString();
  const outcome = await fetchRaw(SCOREBOARD_URL);
  if (!outcome.ok) {
    console.error(`[recorder] scoreboard failed: ${outcome.error}`);
    await recordPoll(
      {
        receivedAt,
        eventId: SCOREBOARD_EVENT_ID,
        kind: 'scoreboard',
        status: 'error',
        playCount: 0,
        bytes: 0,
        changed: false,
        error: outcome.error,
      },
      false,
    );
    return;
  }

  let jsonOk = false;
  try {
    parseScoreboard(JSON.parse(outcome.body.toString('utf8')));
    jsonOk = true;
  } catch (error) {
    console.error(`[recorder] scoreboard JSON failed: ${message(error)}`);
  }
  ensureForced();

  const dir = path.join(outputDir, SCOREBOARD_EVENT_ID);
  if (!scoreboardHashLoaded) {
    scoreboardHash = await latestBodyHash(dir);
    scoreboardHashLoaded = true;
  }
  const hash = hashBody(outcome.body);
  const changed = hash !== scoreboardHash;
  if (changed) await writeGzip(dir, receivedAt, outcome.body);
  scoreboardHash = hash;
  await recordPoll(
    {
      receivedAt,
      eventId: SCOREBOARD_EVENT_ID,
      kind: 'scoreboard',
      status: jsonOk ? 'ok' : 'unknown',
      playCount: 0,
      bytes: outcome.body.length,
      changed,
    },
    true,
  );
  console.log(
    `[recorder] scoreboard games=${games.size} bytes=${outcome.body.length} changed=${changed}`,
  );
}

function noteFinalProgress(game: TrackedGame, meta: SummaryMeta): void {
  if (!meta.final) {
    if (game.phase === 'extra') game.phase = 'polling';
    return;
  }
  if (game.phase === 'extra') {
    game.phase = 'done';
    console.log(`[recorder] ${game.eventId} final, extra poll saved`);
    return;
  }
  game.phase = 'extra';
}

async function pollSummary(game: TrackedGame): Promise<void> {
  if (game.phase === 'idle') game.phase = 'polling';
  const receivedAt = new Date().toISOString();
  const outcome = await fetchRaw(summaryUrl(game.eventId));
  if (!outcome.ok) {
    console.error(`[recorder] summary ${game.eventId} failed: ${outcome.error}`);
    await recordPoll(
      {
        receivedAt,
        eventId: game.eventId,
        kind: 'summary',
        status: 'error',
        playCount: 0,
        bytes: 0,
        changed: false,
        error: outcome.error,
      },
      false,
    );
    return;
  }

  let meta: SummaryMeta | null = null;
  try {
    meta = inspectSummary(JSON.parse(outcome.body.toString('utf8')));
  } catch (error) {
    console.error(`[recorder] summary ${game.eventId} JSON failed: ${message(error)}`);
  }
  if (meta) {
    if (meta.home) game.home = meta.home;
    if (meta.away) game.away = meta.away;
    game.state = meta.state;
    game.completed = meta.final;
  }

  const dir = path.join(outputDir, game.eventId);
  if (!game.hashLoaded) {
    game.lastHash = await latestBodyHash(dir);
    game.hashLoaded = true;
  }
  const hash = hashBody(outcome.body);
  const changed = hash !== game.lastHash;
  if (changed) await writeGzip(dir, receivedAt, outcome.body);
  game.lastHash = hash;
  const status = meta?.state ?? 'unknown';
  const playCount = countPlays(meta);
  await recordPoll(
    {
      receivedAt,
      eventId: game.eventId,
      kind: 'summary',
      status,
      playCount,
      bytes: outcome.body.length,
      changed,
    },
    true,
  );
  console.log(
    `[recorder] summary ${game.eventId} ${game.away} @ ${game.home} state=${status} plays=${playCount} bytes=${outcome.body.length} changed=${changed}`,
  );
  if (meta) noteFinalProgress(game, meta);
}

function track(promise: Promise<void>): void {
  const guarded = promise.catch((error: unknown) => {
    console.error(`[recorder] poll failed: ${message(error)}`);
  });
  inflight.add(guarded);
  void guarded.finally(() => {
    inflight.delete(guarded);
  });
}

async function waitForInflight(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.all([...inflight]);
  }
}

function startDue(now: number): void {
  if (stopRequested) return;

  if (!scoreboardInFlight && now >= scoreboardNextDue) {
    scoreboardInFlight = true;
    const pending = pollScoreboard().finally(() => {
      scoreboardInFlight = false;
      scoreboardNextDue = Date.now() + SCOREBOARD_INTERVAL_MS;
      nudge();
    });
    track(pending);
  }

  for (const game of [...games.values()]) {
    if (game.inFlight || game.phase === 'done') continue;
    if (!shouldPoll(game, now)) continue;
    if (now < game.nextDue) continue;
    game.inFlight = true;
    const pending = pollSummary(game).finally(() => {
      game.inFlight = false;
      if (game.phase !== 'done') game.nextDue = Date.now() + SUMMARY_INTERVAL_MS;
      nudge();
    });
    track(pending);
  }
}

function millisUntilWake(now: number): number {
  let wait = scoreboardNextDue - now;
  for (const game of games.values()) {
    if (forcedEventId !== null && game.eventId !== forcedEventId) continue;
    if (game.phase === 'done' || game.inFlight) continue;
    if (shouldPoll(game, now)) {
      wait = Math.min(wait, game.nextDue - now);
      continue;
    }
    if (!isGameFinal(game) && game.kickoffMs !== null) {
      wait = Math.min(wait, game.kickoffMs - KICKOFF_WINDOW_MS - now);
    }
  }
  if (!Number.isFinite(wait) || wait < 50) return 50;
  return Math.min(wait, SCOREBOARD_INTERVAL_MS);
}

function formatGame(game: TrackedGame, now: number): string {
  const kickoff =
    game.kickoffMs === null
      ? 'kickoff unknown'
      : `kickoff ${new Date(game.kickoffMs).toISOString()}`;
  let mode = 'waiting';
  if (shouldPoll(game, now)) mode = 'polling';
  else if (isGameFinal(game)) mode = 'final';
  return `  ${game.eventId}  ${game.away} @ ${game.home}  ${game.state}  ${kickoff}  ${mode}`;
}

function printStartup(now: number): void {
  const ordered = [...games.values()].sort((a, b) => {
    const ak = a.kickoffMs ?? Number.POSITIVE_INFINITY;
    const bk = b.kickoffMs ?? Number.POSITIVE_INFINITY;
    if (ak !== bk) return ak - bk;
    return a.eventId.localeCompare(b.eventId);
  });
  console.log(`[recorder] pid ${process.pid}`);
  console.log(`[recorder] output ${outputDir}`);
  console.log(`[recorder] games found: ${ordered.length}`);
  for (const game of ordered) console.log(formatGame(game, now));
  if (forcedEventId !== null) console.log(`[recorder] forcing event ${forcedEventId}`);
}

async function removeOwnPid(): Promise<void> {
  try {
    const text = await readFile(PID_FILE, 'utf8');
    if (text.trim() !== String(process.pid)) return;
    await unlink(PID_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[recorder] could not remove pid file: ${message(error)}`);
    }
  }
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));

  const date = newYorkDate(new Date());
  outputDir = path.join(RECORDINGS_ROOT, date);
  indexPath = path.join(outputDir, 'index.jsonl');
  await mkdir(outputDir, { recursive: true });

  try {
    await pollScoreboard();
  } catch (error) {
    console.error(`[recorder] scoreboard failed: ${message(error)}`);
  }
  ensureForced();
  printStartup(Date.now());
  await writeStatusFile();
  scoreboardNextDue = Date.now() + SCOREBOARD_INTERVAL_MS;

  while (!stopRequested && !allRelevantSettled()) {
    startDue(Date.now());
    if (stopRequested || allRelevantSettled()) break;
    await sleep(millisUntilWake(Date.now()));
  }

  await waitForInflight();
  await persistChain;
  await writeStatusFile();
  await removeOwnPid();
  console.log(
    stopRequested ? '[recorder] stopped (signal)' : '[recorder] stopped (every game final)',
  );
}

installSignals();

main().catch((error: unknown) => {
  console.error(`[recorder] fatal: ${message(error)}`);
  process.exitCode = 1;
});
