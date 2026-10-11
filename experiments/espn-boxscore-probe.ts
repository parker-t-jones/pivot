/**
 * THROWAWAY — experiments only. Not part of the Pivot app, not production code.
 *
 * Polls ESPN's public NFL scoreboard and, for each in-progress game, the same summary
 * endpoint ingestion uses (`.../summary?event={id}`). Appends one JSONL line per game when
 * the newest play or any tracked boxscore stat changes, and keeps a gzipped raw summary
 * every five minutes as a field-path reference.
 *
 * Scoreboard `odds` are saved once at startup and then hourly.
 *
 *   caffeinate -i pnpm exec tsx experiments/espn-boxscore-probe.ts
 *
 * Logs (gitignored), under the America/New_York date the process started:
 *   experiments/logs/boxscore-probe/<YYYY-MM-DD>/<eventId>.jsonl
 *   experiments/logs/boxscore-probe/<YYYY-MM-DD>/<eventId>/<receivedAt>.json.gz
 *   experiments/logs/boxscore-probe/<YYYY-MM-DD>/odds-<receivedAt>.json
 *
 * A failure on one game is logged. The process keeps polling the rest. SIGINT finishes
 * the current poll and exits. A second signal exits immediately.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const SCOREBOARD_URL = `${BASE_URL}/scoreboard`;
const summaryUrl = (eventId: string): string => `${BASE_URL}/summary?event=${eventId}`;

const POLL_MS = 10_000;
const SNAPSHOT_MS = 5 * 60 * 1000;
const ODDS_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const NY_TIME_ZONE = 'America/New_York';

/** ESPN stat `keys` entry for each single-valued `StatKey`. */
const SINGLE_STATS = [
  ['RUSH_YDS', 'rushingYards'],
  ['REC_YDS', 'receivingYards'],
  ['PASS_YDS', 'passingYards'],
  ['RECEPTIONS', 'receptions'],
  ['RUSH_ATT', 'rushingAttempts'],
  ['PASS_TD', 'passingTouchdowns'],
] as const;

/**
 * Anytime-TD cells other than the passer's passingTouchdowns. A player can have more
 * than one. The line lists every path that was added.
 */
const ANY_TD_KEYS = [
  'rushingTouchdowns',
  'receivingTouchdowns',
  'kickReturnTouchdowns',
  'puntReturnTouchdowns',
  'defensiveTouchdowns',
  'interceptionTouchdowns',
] as const;

type SingleStatKey = (typeof SINGLE_STATS)[number][0];
type AnyTdKey = (typeof ANY_TD_KEYS)[number];

interface StatCell {
  value: number | null;
  /** ESPN `keys` name. ANY_TD joins the keys that were present with "+". */
  key: string;
  /** Exact path in that response, or null when the player had no such cell. */
  path: string | null;
}

interface PlayerLine {
  espn_athlete_id: string;
  id_path: string;
  display_name: string | null;
  jersey: string | null;
  team_id: string | null;
  team_abbreviation: string | null;
  team_path: string;
  position: string | null;
  position_path: string | null;
  stats: Record<SingleStatKey, StatCell> & { ANY_TD: StatCell };
}

interface PlayRef {
  id: string | null;
  wallclock: string | null;
}

interface PollLine {
  polled_at: string;
  event_id: string;
  away: string;
  home: string;
  game_state: string | null;
  play: PlayRef | null;
  play_count: number;
  players_missing_id: number;
  players: PlayerLine[];
}

interface ListedEvent {
  eventId: string;
  away: string;
  home: string;
  state: string;
  statusName: string | null;
  shortName: string | null;
}

interface OddsSide {
  abbreviation: string | null;
  favorite: boolean | null;
  spread_line: string | null;
}

interface OddsEntry {
  spread: number | null;
  total: number | null;
  provider_id: string | null;
  provider_name: string | null;
  details: string | null;
  home: OddsSide;
  away: OddsSide;
}

interface OddsEventRecord {
  event_id: string;
  short_name: string | null;
  state: string;
  status_name: string | null;
  away: string;
  home: string;
  odds_present: boolean;
  odds_path: string | null;
  odds: OddsEntry[];
}

interface GameWatch {
  away: string;
  home: string;
  fingerprint: string | null;
  lastSnapshotAt: number;
  closed: boolean;
}

interface CellHit {
  key: string;
  value: number | null;
  path: string;
}

let stopRequested = false;
let wakeSleep: (() => void) | null = null;
let signalCount = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nyDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function fileStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '');
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
    if (stopRequested) finish();
  });
}

function installSignals(): void {
  // Node resets SIGHUP to terminate, which kills a long run when the terminal drops.
  process.on('SIGHUP', () => undefined);
  const onSignal = (name: string): void => {
    signalCount += 1;
    if (signalCount >= 2) {
      console.error('[probe] second signal, exiting now');
      process.exit(1);
    }
    stopRequested = true;
    console.log(`[probe] ${name}, finishing this poll`);
    wakeSleep?.();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[probe] ${url} HTTP ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(`[probe] ${url} ${message(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readStatus(status: Record<string, unknown> | null): {
  state: string;
  name: string | null;
} {
  const type = asRecord(status?.['type']);
  const state = typeof type?.['state'] === 'string' ? type['state'] : 'unknown';
  const name = typeof type?.['name'] === 'string' ? type['name'] : null;
  return { state, name };
}

function readCompetitors(competition: Record<string, unknown> | null): {
  home: string;
  away: string;
} {
  const competitors = competition?.['competitors'];
  let home = '??';
  let away = '??';
  if (!Array.isArray(competitors)) return { home, away };
  for (const entry of competitors) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const team = asRecord(rec['team']);
    const abbr = typeof team?.['abbreviation'] === 'string' ? team['abbreviation'] : '??';
    if (rec['homeAway'] === 'home') home = abbr;
    if (rec['homeAway'] === 'away') away = abbr;
  }
  return { home, away };
}

export function listEvents(scoreboard: unknown): ListedEvent[] {
  const events = asRecord(scoreboard)?.['events'];
  if (!Array.isArray(events)) return [];
  const listed: ListedEvent[] = [];
  for (const event of events) {
    const rec = asRecord(event);
    const eventId = rec?.['id'];
    if (!rec || typeof eventId !== 'string' || !/^\d+$/.test(eventId)) continue;
    const competitions = rec['competitions'];
    const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
    const teams = readCompetitors(competition);
    const status = readStatus(asRecord(rec['status']) ?? asRecord(competition?.['status']));
    listed.push({
      eventId,
      away: teams.away,
      home: teams.home,
      state: status.state,
      statusName: status.name,
      shortName: typeof rec['shortName'] === 'string' ? rec['shortName'] : null,
    });
  }
  return listed;
}

function readSpreadLine(side: Record<string, unknown> | null): string | null {
  const close = asRecord(side?.['close']);
  const line = close?.['line'];
  return typeof line === 'string' ? line : null;
}

function readOddsSide(
  teamOdds: Record<string, unknown> | null,
  spreadSide: Record<string, unknown> | null,
): OddsSide {
  const team = asRecord(teamOdds?.['team']);
  return {
    abbreviation: typeof team?.['abbreviation'] === 'string' ? team['abbreviation'] : null,
    favorite: typeof teamOdds?.['favorite'] === 'boolean' ? teamOdds['favorite'] : null,
    spread_line: readSpreadLine(spreadSide),
  };
}

function readOddsEntry(entry: Record<string, unknown>): OddsEntry {
  const provider = asRecord(entry['provider']);
  const pointSpread = asRecord(entry['pointSpread']);
  return {
    spread: typeof entry['spread'] === 'number' ? entry['spread'] : null,
    total: typeof entry['overUnder'] === 'number' ? entry['overUnder'] : null,
    provider_id: typeof provider?.['id'] === 'string' ? provider['id'] : null,
    provider_name: typeof provider?.['name'] === 'string' ? provider['name'] : null,
    details: typeof entry['details'] === 'string' ? entry['details'] : null,
    home: readOddsSide(asRecord(entry['homeTeamOdds']), asRecord(pointSpread?.['home'])),
    away: readOddsSide(asRecord(entry['awayTeamOdds']), asRecord(pointSpread?.['away'])),
  };
}

function readOddsEntries(value: unknown): OddsEntry[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const rec = asRecord(item);
      return rec ? [readOddsEntry(rec)] : [];
    });
  }
  const rec = asRecord(value);
  return rec ? [readOddsEntry(rec)] : [];
}

function oddsBlock(event: Record<string, unknown>): { path: string; entries: OddsEntry[] } | null {
  const competitions = event['competitions'];
  const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
  const fromCompetition = readOddsEntries(competition?.['odds']);
  if (fromCompetition.length > 0) return { path: 'competitions[0].odds', entries: fromCompetition };
  const fromEvent = readOddsEntries(event['odds']);
  if (fromEvent.length > 0) return { path: 'odds', entries: fromEvent };
  return null;
}

export function oddsRecords(scoreboard: unknown): OddsEventRecord[] {
  const events = asRecord(scoreboard)?.['events'];
  if (!Array.isArray(events)) return [];
  const records: OddsEventRecord[] = [];
  for (const event of events) {
    const rec = asRecord(event);
    const eventId = rec?.['id'];
    if (!rec || typeof eventId !== 'string') continue;
    const listed = listEvents({ events: [event] })[0];
    const block = oddsBlock(rec);
    records.push({
      event_id: eventId,
      short_name: listed?.shortName ?? null,
      state: listed?.state ?? 'unknown',
      status_name: listed?.statusName ?? null,
      away: listed?.away ?? '??',
      home: listed?.home ?? '??',
      odds_present: block !== null,
      odds_path: block?.path ?? null,
      odds: block?.entries ?? [],
    });
  }
  return records;
}

function parseStat(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isAnyTdKey(key: string): key is AnyTdKey {
  return (ANY_TD_KEYS as readonly string[]).includes(key);
}

function readPosition(
  entry: Record<string, unknown>,
  entryPath: string,
): { position: string | null; position_path: string | null } {
  const athlete = asRecord(entry['athlete']);
  const candidates = [
    { node: athlete, nodePath: `${entryPath}.athlete` },
    { node: entry, nodePath: entryPath },
  ];
  for (const candidate of candidates) {
    if (!candidate.node) continue;
    const position = candidate.node['position'];
    if (typeof position === 'string' && position.length > 0) {
      return { position, position_path: `${candidate.nodePath}.position` };
    }
    const pos = asRecord(position);
    if (!pos) continue;
    const abbreviation = pos['abbreviation'];
    if (typeof abbreviation === 'string' && abbreviation.length > 0) {
      return {
        position: abbreviation,
        position_path: `${candidate.nodePath}.position.abbreviation`,
      };
    }
    const name = pos['name'];
    if (typeof name === 'string' && name.length > 0) {
      return { position: name, position_path: `${candidate.nodePath}.position.name` };
    }
  }
  return { position: null, position_path: null };
}

function emptyStats(): PlayerLine['stats'] {
  const stats = {
    ANY_TD: { value: null, key: ANY_TD_KEYS.join('+'), path: null },
  } as PlayerLine['stats'];
  for (const [statKey, espnKey] of SINGLE_STATS) {
    stats[statKey] = { value: null, key: espnKey, path: null };
  }
  return stats;
}

function flattenPlays(summary: Record<string, unknown>): Record<string, unknown>[] {
  const drives = asRecord(summary['drives']);
  const plays: Record<string, unknown>[] = [];
  const previous = drives?.['previous'];
  if (Array.isArray(previous)) {
    for (const drive of previous) {
      const list = asRecord(drive)?.['plays'];
      if (!Array.isArray(list)) continue;
      for (const play of list) {
        const rec = asRecord(play);
        if (rec) plays.push(rec);
      }
    }
  }
  const current = asRecord(drives?.['current'])?.['plays'];
  if (Array.isArray(current)) {
    for (const play of current) {
      const rec = asRecord(play);
      if (rec) plays.push(rec);
    }
  }
  return plays;
}

function summaryGameState(summary: Record<string, unknown>): string | null {
  const header = asRecord(summary['header']);
  const competitions = header?.['competitions'];
  const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
  const status = readStatus(asRecord(competition?.['status']));
  return status.state === 'unknown' ? null : status.state;
}

function applyAnyTd(draft: PlayerLine, hits: CellHit[]): void {
  if (hits.length === 0) return;
  const numbered = hits.filter((hit) => hit.value !== null);
  draft.stats.ANY_TD = {
    value: numbered.length === 0 ? null : numbered.reduce((sum, hit) => sum + (hit.value ?? 0), 0),
    key: hits.map((hit) => hit.key).join('+'),
    path: hits.map((hit) => hit.path).join(' + '),
  };
}

export function buildPollLine(summary: unknown, event: ListedEvent, polledAt: string): PollLine {
  const root = asRecord(summary) ?? {};
  const plays = flattenPlays(root);
  const newest = plays.at(-1) ?? null;
  const boxscore = asRecord(root['boxscore']);
  const teams = boxscore?.['players'];
  const drafts = new Map<string, PlayerLine>();
  const anyTdHits = new Map<string, CellHit[]>();
  let playersMissingId = 0;

  if (Array.isArray(teams)) {
    for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
      const teamEntry = asRecord(teams[teamIndex]);
      if (!teamEntry) continue;
      const team = asRecord(teamEntry['team']);
      const teamId = typeof team?.['id'] === 'string' ? team['id'] : null;
      const teamAbbreviation =
        typeof team?.['abbreviation'] === 'string' ? team['abbreviation'] : null;
      const teamPath = `boxscore.players[${teamIndex}].team`;
      const statistics = teamEntry['statistics'];
      if (!Array.isArray(statistics)) continue;

      for (let categoryIndex = 0; categoryIndex < statistics.length; categoryIndex += 1) {
        const category = asRecord(statistics[categoryIndex]);
        const keys = category?.['keys'];
        const athletes = category?.['athletes'];
        if (!category || !Array.isArray(keys) || !Array.isArray(athletes)) continue;

        for (let athleteIndex = 0; athleteIndex < athletes.length; athleteIndex += 1) {
          const entry = asRecord(athletes[athleteIndex]);
          const athlete = asRecord(entry?.['athlete']);
          const athleteId = athlete?.['id'];
          if (!entry || !athlete || typeof athleteId !== 'string' || athleteId.length === 0) {
            playersMissingId += 1;
            continue;
          }
          const entryPath =
            `boxscore.players[${teamIndex}].statistics[${categoryIndex}]` +
            `.athletes[${athleteIndex}]`;
          const draftKey = `${teamId ?? String(teamIndex)}:${athleteId}`;
          let draft = drafts.get(draftKey);
          if (!draft) {
            const position = readPosition(entry, entryPath);
            draft = {
              espn_athlete_id: athleteId,
              id_path: `${entryPath}.athlete.id`,
              display_name:
                typeof athlete['displayName'] === 'string' ? athlete['displayName'] : null,
              jersey: typeof athlete['jersey'] === 'string' ? athlete['jersey'] : null,
              team_id: teamId,
              team_abbreviation: teamAbbreviation,
              team_path: teamPath,
              position: position.position,
              position_path: position.position_path,
              stats: emptyStats(),
            };
            drafts.set(draftKey, draft);
            anyTdHits.set(draftKey, []);
          } else if (draft.position === null) {
            const position = readPosition(entry, entryPath);
            draft.position = position.position;
            draft.position_path = position.position_path;
          }

          const statValues = entry['stats'];
          if (!Array.isArray(statValues)) continue;
          const hits = anyTdHits.get(draftKey) ?? [];
          const limit = Math.min(keys.length, statValues.length);
          for (let statIndex = 0; statIndex < limit; statIndex += 1) {
            const espnKey = keys[statIndex];
            if (typeof espnKey !== 'string') continue;
            const cellPath = `${entryPath}.stats[${statIndex}]`;
            const value = parseStat(statValues[statIndex]);
            const single = SINGLE_STATS.find(([, key]) => key === espnKey);
            if (single && draft.stats[single[0]].path === null) {
              draft.stats[single[0]] = { value, key: espnKey, path: cellPath };
            }
            if (isAnyTdKey(espnKey)) hits.push({ key: espnKey, value, path: cellPath });
          }
        }
      }
    }
  }

  for (const [draftKey, draft] of drafts) applyAnyTd(draft, anyTdHits.get(draftKey) ?? []);

  const players = [...drafts.values()];
  players.sort((left, right) => {
    const byTeam = (left.team_abbreviation ?? '').localeCompare(right.team_abbreviation ?? '');
    if (byTeam !== 0) return byTeam;
    return left.espn_athlete_id.localeCompare(right.espn_athlete_id);
  });

  return {
    polled_at: polledAt,
    event_id: event.eventId,
    away: event.away,
    home: event.home,
    game_state: summaryGameState(root),
    play:
      newest === null
        ? null
        : {
            id: typeof newest['id'] === 'string' ? newest['id'] : null,
            wallclock: typeof newest['wallclock'] === 'string' ? newest['wallclock'] : null,
          },
    play_count: plays.length,
    players_missing_id: playersMissingId,
    players,
  };
}

function fingerprint(line: PollLine): string {
  const stats = line.players.map((player) => [
    player.espn_athlete_id,
    player.team_id,
    player.stats.RUSH_YDS.value,
    player.stats.REC_YDS.value,
    player.stats.PASS_YDS.value,
    player.stats.RECEPTIONS.value,
    player.stats.RUSH_ATT.value,
    player.stats.PASS_TD.value,
    player.stats.ANY_TD.value,
  ]);
  return JSON.stringify({
    play: line.play?.id ?? null,
    count: line.play_count,
    missing: line.players_missing_id,
    stats,
  });
}

async function writeSummaryGzip(
  dir: string,
  eventId: string,
  receivedAt: Date,
  body: string,
): Promise<void> {
  const folder = path.join(dir, eventId);
  await mkdir(folder, { recursive: true });
  const gz = await gzipAsync(Buffer.from(body));
  await writeFile(path.join(folder, `${fileStamp(receivedAt)}.json.gz`), gz);
}

async function pollGame(
  dir: string,
  event: ListedEvent,
  watch: GameWatch,
  closing: boolean,
): Promise<boolean> {
  const body = await fetchText(summaryUrl(event.eventId));
  if (body === null) {
    if (closing) watch.closed = true;
    return false;
  }
  let summary: unknown;
  try {
    summary = JSON.parse(body) as unknown;
  } catch (error) {
    console.error(`[probe] ${event.eventId} JSON ${message(error)}`);
    if (closing) watch.closed = true;
    return false;
  }

  const receivedAt = new Date();
  const due =
    closing ||
    watch.lastSnapshotAt === 0 ||
    receivedAt.getTime() - watch.lastSnapshotAt >= SNAPSHOT_MS;
  if (due) {
    try {
      await writeSummaryGzip(dir, event.eventId, receivedAt, body);
      watch.lastSnapshotAt = receivedAt.getTime();
    } catch (error) {
      console.error(`[probe] ${event.eventId} snapshot ${message(error)}`);
    }
  }

  const line = buildPollLine(summary, event, receivedAt.toISOString());
  const next = fingerprint(line);
  if (next !== watch.fingerprint) {
    try {
      await appendFile(
        path.join(dir, `${event.eventId}.jsonl`),
        `${JSON.stringify(line)}\n`,
        'utf8',
      );
      watch.fingerprint = next;
      console.log(
        `[probe] ${event.away}@${event.home} ${event.eventId} plays=${line.play_count}` +
          ` play=${line.play?.id ?? '-'} players=${line.players.length}`,
      );
    } catch (error) {
      console.error(`[probe] ${event.eventId} log ${message(error)}`);
    }
  }
  if (closing) watch.closed = true;
  return true;
}

async function saveOdds(dir: string): Promise<boolean> {
  const body = await fetchText(SCOREBOARD_URL);
  if (body === null) return false;
  let scoreboard: unknown;
  try {
    scoreboard = JSON.parse(body) as unknown;
  } catch (error) {
    console.error(`[probe] scoreboard JSON ${message(error)}`);
    return false;
  }
  const events = oddsRecords(scoreboard);
  const savedAt = new Date();
  const target = path.join(dir, `odds-${fileStamp(savedAt)}.json`);
  const present = events.filter((event) => event.odds_present).length;
  try {
    await writeFile(
      target,
      `${JSON.stringify({ saved_at: savedAt.toISOString(), events }, null, 2)}\n`,
    );
  } catch (error) {
    console.error(`[probe] odds write ${message(error)}`);
    return false;
  }
  console.log(
    `[probe] odds events=${events.length} present=${present} missing=${events.length - present}`,
  );
  return true;
}

async function cycle(dir: string, watched: Map<string, GameWatch>): Promise<void> {
  const body = await fetchText(SCOREBOARD_URL);
  if (body === null) return;
  let scoreboard: unknown;
  try {
    scoreboard = JSON.parse(body) as unknown;
  } catch (error) {
    console.error(`[probe] scoreboard JSON ${message(error)}`);
    return;
  }
  const events = listEvents(scoreboard);
  const inProgress = new Map(
    events.filter((event) => event.state === 'in').map((event) => [event.eventId, event]),
  );

  const jobs: { event: ListedEvent; closing: boolean }[] = [];
  for (const event of inProgress.values()) jobs.push({ event, closing: false });
  for (const [eventId, watch] of watched) {
    if (watch.closed || inProgress.has(eventId)) continue;
    const stillListed = events.find((event) => event.eventId === eventId);
    jobs.push({
      event: stillListed ?? {
        eventId,
        away: watch.away,
        home: watch.home,
        state: 'unknown',
        statusName: null,
        shortName: null,
      },
      closing: true,
    });
  }

  await Promise.all(
    jobs.map(async (job) => {
      let watch = watched.get(job.event.eventId);
      if (!watch) {
        watch = {
          away: job.event.away,
          home: job.event.home,
          fingerprint: null,
          lastSnapshotAt: 0,
          closed: false,
        };
        watched.set(job.event.eventId, watch);
      }
      watch.away = job.event.away;
      watch.home = job.event.home;
      try {
        await pollGame(dir, job.event, watch, job.closing);
      } catch (error) {
        console.error(`[probe] ${job.event.eventId} ${message(error)}`);
        if (job.closing) watch.closed = true;
      }
    }),
  );
  console.log(`[probe] in=${inProgress.size} tracking=${watched.size}`);
}

async function main(): Promise<void> {
  installSignals();
  const started = new Date();
  const dir = path.resolve(__dirname, 'logs/boxscore-probe', nyDate(started));
  await mkdir(dir, { recursive: true });
  console.log(`[probe] writing ${dir}`);
  console.log('[probe] stop with Ctrl+C');

  const watched = new Map<string, GameWatch>();
  let nextOddsAt = 0;
  while (!stopRequested) {
    const cycleStart = Date.now();
    if (Date.now() >= nextOddsAt) {
      const saved = await saveOdds(dir);
      if (saved) nextOddsAt = Date.now() + ODDS_MS;
    }
    if (stopRequested) break;
    try {
      await cycle(dir, watched);
    } catch (error) {
      console.error(`[probe] cycle ${message(error)}`);
    }
    const remain = POLL_MS - (Date.now() - cycleStart);
    if (remain > 0 && !stopRequested) await sleep(remain);
  }
  console.log('[probe] stopped');
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(`[probe] fatal ${message(error)}`);
    process.exitCode = 1;
  });
}
