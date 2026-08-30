/**
 * Fetches the 2026 NFL preseason + regular-season schedule from ESPN's public scoreboard API
 * (no auth) and writes `data/nfl-schedule-2026.json` for `pnpm seed:schedule` to consume.
 *
 * Annual refresh: re-run this script (or bump the year) when the next season's slate is published.
 * `@pivot/ingestion`'s `EspnPlaySource` (Section 5/8) is the committed live-feed consumer but isn't
 * wired to own the schedule yet, so this script + `pnpm seed:schedule` remains the interim schedule
 * source — see PLAN Known Issues.
 *
 * Usage: `pnpm fetch:nfl-schedule` from the repo root.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEASON_YEAR = 2026;
const OUT_PATH = path.resolve(__dirname, `../data/nfl-schedule-${SEASON_YEAR}.json`);

/** ESPN uses WSH; our `teams.abbreviation` seed uses WAS. */
export const ESPN_TEAM_ABBREVIATION_OVERRIDES: Record<string, string> = {
  WSH: 'WAS',
};

export type ScheduleSeasonType = 'pre' | 'regular';

export interface ScheduleGameRecord {
  /** Stable upsert key written to `games.sportradar_id` until Sportradar ids exist. */
  external_id: string;
  season_year: number;
  season_type: ScheduleSeasonType;
  week: number;
  /** ISO timestamptz UTC from ESPN. */
  scheduled_start: string;
  home_team: string;
  away_team: string;
  venue: string | null;
  status: 'scheduled';
}

export interface NflScheduleFile {
  season_year: number;
  source: 'espn_site_api_v2';
  fetched_at: string;
  games: ScheduleGameRecord[];
}

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  team: { abbreviation: string };
}

interface EspnEvent {
  id: string;
  date: string;
  competitions: Array<{
    competitors: EspnCompetitor[];
    venue?: { fullName?: string };
  }>;
}

interface EspnScoreboard {
  events?: EspnEvent[];
}

export function resolveTeamAbbreviation(espnAbbr: string): string {
  return ESPN_TEAM_ABBREVIATION_OVERRIDES[espnAbbr] ?? espnAbbr;
}

export function parseEspnEvent(
  event: EspnEvent,
  seasonType: ScheduleSeasonType,
  week: number,
  seasonYear: number,
): ScheduleGameRecord | null {
  const competition = event.competitions[0];
  if (!competition) return null;
  const home = competition.competitors.find((c) => c.homeAway === 'home');
  const away = competition.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  return {
    external_id: `seed:espn:${event.id}`,
    season_year: seasonYear,
    season_type: seasonType,
    week,
    scheduled_start: event.date.endsWith('Z') ? event.date : `${event.date}Z`,
    home_team: resolveTeamAbbreviation(home.team.abbreviation),
    away_team: resolveTeamAbbreviation(away.team.abbreviation),
    venue: competition.venue?.fullName ?? null,
    status: 'scheduled',
  };
}

async function fetchScoreboard(
  seasonType: 1 | 2,
  week: number,
  seasonYear: number,
): Promise<EspnScoreboard> {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?dates=${seasonYear}&seasontype=${seasonType}&week=${week}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN scoreboard failed (${seasonType}/${week}): ${response.status}`);
  }
  return (await response.json()) as EspnScoreboard;
}

export async function fetchNflSchedule(seasonYear: number = SEASON_YEAR): Promise<NflScheduleFile> {
  const games: ScheduleGameRecord[] = [];
  const seen = new Set<string>();

  // Preseason: ESPN weeks 1–4 (HOF + Pre Wk 1–3). Regular: weeks 1–18. No postseason.
  const phases: Array<{ espnType: 1 | 2; seasonType: ScheduleSeasonType; weeks: number }> = [
    { espnType: 1, seasonType: 'pre', weeks: 4 },
    { espnType: 2, seasonType: 'regular', weeks: 18 },
  ];

  for (const phase of phases) {
    for (let week = 1; week <= phase.weeks; week++) {
      const board = await fetchScoreboard(phase.espnType, week, seasonYear);
      for (const event of board.events ?? []) {
        const row = parseEspnEvent(event, phase.seasonType, week, seasonYear);
        if (!row) continue;
        if (seen.has(row.external_id)) continue;
        seen.add(row.external_id);
        games.push(row);
      }
    }
  }

  games.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  return {
    season_year: seasonYear,
    source: 'espn_site_api_v2',
    fetched_at: new Date().toISOString(),
    games,
  };
}

export async function writeNflScheduleFile(
  schedule: NflScheduleFile,
  outPath: string = OUT_PATH,
): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  console.log(`Fetching ${SEASON_YEAR} NFL preseason + regular schedule from ESPN...`);
  const schedule = await fetchNflSchedule(SEASON_YEAR);
  const pre = schedule.games.filter((g) => g.season_type === 'pre').length;
  const regular = schedule.games.filter((g) => g.season_type === 'regular').length;
  await writeNflScheduleFile(schedule);
  console.log(
    `Wrote ${schedule.games.length} games (${pre} pre, ${regular} regular) → ${OUT_PATH}`,
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
