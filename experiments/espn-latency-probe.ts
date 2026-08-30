/**
 * ONE-OFF THROWAWAY SCRIPT — not part of the Pivot app, not production code.
 *
 * Polls ESPN's public NFL endpoints for today's Colts @ Lions game and logs every
 * new play the instant it shows up in ESPN's data, with a wall-clock timestamp.
 * The intent is to run this live during the broadcast and manually compare these
 * timestamps against when you actually see each play happen on YouTube TV, to get
 * an empirical read on ESPN's feed latency vs. a live TV broadcast.
 *
 * Also captures each play's structured `type.id`/`type.text` classification plus the
 * scoringPlay/isTurnover/isPenalty flags, so a deny-list of procedural play types
 * (timeouts, end-of-period, two-minute warning, etc.) can be built from real ESPN
 * type IDs instead of pattern-matching the free-text description.
 *
 * SUPERSEDED for production use: the classification work this script fed into now lives in
 * `services/ingestion/src/espn/espnPlayTypeMap.ts` (ESPN `type.id` -> normalized `PlayType`) and
 * `services/engine/src/resumptionWatcher.ts` (the classifier/watcher that consumes it). This
 * script is kept only as the original latency-measurement/data-capture tool, not as a source of
 * current classification logic.
 *
 * Usage:
 *   npx tsx experiments/espn-latency-probe.ts
 *
 * Output:
 *   - console.log for every new play as it's detected
 *   - appended to experiments/game-latency-log.txt (same lines, plain text)
 *
 * This is deliberately quick-and-dirty: no retries with backoff, no config file,
 * no tests. Just enough error handling to survive a flaky fetch during a live game.
 */

import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, 'game-latency-log.txt');

const AWAY_TEAM = 'Colts';
const HOME_TEAM = 'Lions';
const POLL_INTERVAL_MS = 5000;

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const summaryUrl = (eventId: string): string =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;

interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
}

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  team?: EspnTeam;
}

interface EspnStatusType {
  completed?: boolean;
  state?: string;
  name?: string;
}

interface EspnCompetition {
  competitors?: EspnCompetitor[];
}

interface EspnEvent {
  id: string;
  name?: string;
  shortName?: string;
  competitions?: EspnCompetition[];
  status?: { type?: EspnStatusType };
}

interface EspnScoreboard {
  events?: EspnEvent[];
}

interface EspnPlayPeriod {
  number?: number;
}

interface EspnPlayClock {
  displayValue?: string;
}

interface EspnPlayStart {
  downDistanceText?: string;
  shortDownDistanceText?: string;
  team?: { id?: string };
}

/** ESPN's structured play classification, e.g. { id: "74", text: "Official Timeout" }. */
interface EspnPlayType {
  id?: string;
  text?: string;
}

interface EspnPlay {
  id?: string;
  sequenceNumber?: string;
  text?: string;
  period?: EspnPlayPeriod;
  clock?: EspnPlayClock;
  start?: EspnPlayStart;
  type?: EspnPlayType;
  scoringPlay?: boolean;
  isTurnover?: boolean;
  isPenalty?: boolean;
}

interface EspnDriveTeam {
  abbreviation?: string;
}

interface EspnDrive {
  team?: EspnDriveTeam;
  plays?: EspnPlay[];
}

interface EspnBoxscoreTeamEntry {
  team?: { id?: string; abbreviation?: string };
}

interface EspnSummary {
  header?: {
    competitions?: Array<{ status?: { type?: EspnStatusType } }>;
  };
  drives?: {
    previous?: EspnDrive[];
    current?: EspnDrive;
  };
  boxscore?: {
    teams?: EspnBoxscoreTeamEntry[];
  };
}

/** A play plus the drive it came from, so we can fall back to drive-level possession info. */
interface FlattenedPlay {
  play: EspnPlay;
  drive: EspnDrive;
}

function nowStamp(): string {
  // Local wall-clock time, to the second, e.g. "2026-08-29 14:45:03"
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

async function log(line: string): Promise<void> {
  console.log(line);
  try {
    await appendFile(LOG_PATH, `${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[warn] failed to write to log file: ${String(err)}`);
  }
}

async function findTodaysGame(): Promise<string> {
  console.log(`Looking for today's ${AWAY_TEAM} @ ${HOME_TEAM} game on ESPN's scoreboard...`);
  const response = await fetch(SCOREBOARD_URL);
  if (!response.ok) {
    throw new Error(`ESPN scoreboard request failed: ${response.status}`);
  }
  const board = (await response.json()) as EspnScoreboard;

  for (const event of board.events ?? []) {
    const competition = event.competitions?.[0];
    const teamNames = (competition?.competitors ?? []).map(
      (c) => c.team?.displayName ?? c.team?.shortDisplayName ?? c.team?.name ?? '',
    );
    const hasAway = teamNames.some((n) => n.includes(AWAY_TEAM));
    const hasHome = teamNames.some((n) => n.includes(HOME_TEAM));
    if (hasAway && hasHome) {
      console.log(`Found game: ${event.shortName ?? event.name} (event id ${event.id})`);
      return event.id;
    }
  }

  throw new Error(
    `Could not find a ${AWAY_TEAM} @ ${HOME_TEAM} game on today's scoreboard. ` +
      `Is the game actually scheduled for today?`,
  );
}

function isFinal(summary: EspnSummary): boolean {
  const statusType = summary.header?.competitions?.[0]?.status?.type;
  return Boolean(statusType?.completed) || statusType?.state === 'post';
}

function formatDownDistance(play: EspnPlay): string {
  return play.start?.downDistanceText ?? play.start?.shortDownDistanceText ?? '—';
}

function formatPlayType(play: EspnPlay): string {
  const id = play.type?.id ?? '?';
  const text = play.type?.text ?? 'unknown';
  return `${id}/"${text}"`;
}

function formatFlags(play: EspnPlay): string {
  const flags: string[] = [];
  if (play.scoringPlay) flags.push('scoring');
  if (play.isTurnover) flags.push('turnover');
  if (play.isPenalty) flags.push('penalty');
  return flags.length > 0 ? flags.join(',') : '—';
}

function playKey(play: EspnPlay, index: number): string {
  return play.id ?? play.sequenceNumber ?? `idx:${index}`;
}

function buildTeamIdToAbbreviation(summary: EspnSummary): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of summary.boxscore?.teams ?? []) {
    const id = entry.team?.id;
    const abbr = entry.team?.abbreviation;
    if (id && abbr) map.set(id, abbr);
  }
  return map;
}

function resolvePossession(
  play: EspnPlay,
  drive: EspnDrive,
  teamIdToAbbreviation: Map<string, string>,
): string {
  const teamId = play.start?.team?.id;
  if (teamId) {
    const abbr = teamIdToAbbreviation.get(teamId);
    if (abbr) return abbr;
  }
  return drive.team?.abbreviation ?? '—';
}

/** Flattens completed drives + the in-progress drive into a single chronological play list. */
function flattenPlays(summary: EspnSummary): FlattenedPlay[] {
  const flattened: FlattenedPlay[] = [];
  for (const drive of summary.drives?.previous ?? []) {
    for (const play of drive.plays ?? []) {
      flattened.push({ play, drive });
    }
  }
  const current = summary.drives?.current;
  if (current) {
    for (const play of current.plays ?? []) {
      flattened.push({ play, drive: current });
    }
  }
  return flattened;
}

async function pollGame(eventId: string): Promise<void> {
  const seenPlayIds = new Set<string>();
  let loggedPlayKeys = false;
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s. Logging to ${LOG_PATH}`);

  for (;;) {
    let summary: EspnSummary | null = null;
    try {
      const response = await fetch(summaryUrl(eventId));
      if (!response.ok) {
        console.error(`[warn] ESPN summary request failed: ${response.status}, retrying...`);
      } else {
        summary = (await response.json()) as EspnSummary;
      }
    } catch (err) {
      console.error(`[warn] ESPN summary request threw: ${String(err)}, retrying...`);
    }

    if (summary) {
      const teamIdToAbbreviation = buildTeamIdToAbbreviation(summary);
      const flattened = flattenPlays(summary);
      for (const [i, { play, drive }] of flattened.entries()) {
        const key = playKey(play, i);
        if (seenPlayIds.has(key)) continue;
        seenPlayIds.add(key);

        if (!loggedPlayKeys) {
          loggedPlayKeys = true;
          console.log(`[debug] raw play object top-level keys: ${Object.keys(play).join(', ')}`);
        }

        const quarter = play.period?.number != null ? `Q${play.period.number}` : 'Q?';
        const clock = play.clock?.displayValue ?? '?:??';
        const downDistance = formatDownDistance(play);
        const possession = resolvePossession(play, drive, teamIdToAbbreviation);
        const text = play.text ?? '(no play text)';
        const playType = formatPlayType(play);
        const flags = formatFlags(play);

        await log(
          `[${nowStamp()}] ${quarter} ${clock} | ${downDistance} | poss: ${possession} | ${text} | type: ${playType} | flags: ${flags}`,
        );
      }

      if (isFinal(summary)) {
        console.log('Game is final. Exiting.');
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  const eventId = await findTodaysGame();
  await log(`--- Starting poll for event ${eventId} at ${nowStamp()} ---`);
  await pollGame(eventId);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
