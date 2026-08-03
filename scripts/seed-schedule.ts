/**
 * Seeds `public.games` from the committed `data/nfl-schedule-YYYY.json` (Sprint 10 Phase 2.5).
 * No network — regenerate the JSON with `pnpm fetch:nfl-schedule` when the slate changes.
 *
 * Idempotent: upserts on `sportradar_id` (= schedule `external_id`, e.g. `seed:espn:{id}`) until
 * real Sportradar ids land with Sprint 2 ingestion.
 *
 * Usage: `pnpm seed:schedule` from the repo root (apply migrations first, including season_type).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { NflScheduleFile, ScheduleGameRecord } from './fetch-nfl-schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

const SEASON_YEAR = 2026;
const SCHEDULE_PATH = path.resolve(__dirname, `../data/nfl-schedule-${SEASON_YEAR}.json`);

export interface GameSeedRow {
  sportradar_id: string;
  season_year: number;
  season_type: 'pre' | 'regular' | 'post';
  week: number;
  scheduled_start: string;
  home_team_id: string;
  away_team_id: string;
  status: string;
  venue: string | null;
}

export function toGameSeedRow(
  game: ScheduleGameRecord,
  teamIdByAbbreviation: ReadonlyMap<string, string>,
): GameSeedRow {
  const homeTeamId = teamIdByAbbreviation.get(game.home_team);
  const awayTeamId = teamIdByAbbreviation.get(game.away_team);
  if (!homeTeamId) {
    throw new Error(`Unknown home team abbreviation: ${game.home_team} (${game.external_id})`);
  }
  if (!awayTeamId) {
    throw new Error(`Unknown away team abbreviation: ${game.away_team} (${game.external_id})`);
  }
  return {
    sportradar_id: game.external_id,
    season_year: game.season_year,
    season_type: game.season_type,
    week: game.week,
    scheduled_start: game.scheduled_start,
    home_team_id: homeTeamId,
    away_team_id: awayTeamId,
    status: game.status,
    venue: game.venue,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function seedSchedule(
  schedulePath: string = SCHEDULE_PATH,
): Promise<{ upserted: number; pre: number; regular: number }> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.',
    );
  }

  const raw = await readFile(schedulePath, 'utf8');
  const schedule = JSON.parse(raw) as NflScheduleFile;
  if (!Array.isArray(schedule.games) || schedule.games.length === 0) {
    throw new Error(`Schedule file has no games: ${schedulePath}`);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, abbreviation');
  if (teamsError) throw teamsError;
  if (!teams || teams.length === 0) {
    throw new Error('No teams found. Run the Sprint 1 teams seed before seeding the schedule.');
  }
  const teamIdByAbbreviation = new Map(teams.map((t) => [t.abbreviation, t.id]));

  const rows = schedule.games.map((g) => toGameSeedRow(g, teamIdByAbbreviation));
  const pre = rows.filter((r) => r.season_type === 'pre').length;
  const regular = rows.filter((r) => r.season_type === 'regular').length;

  console.log(
    `Upserting ${rows.length} games from ${schedulePath} (${pre} pre, ${regular} regular)...`,
  );

  for (const batch of chunk(rows, 200)) {
    const { error } = await supabase.from('games').upsert(batch, { onConflict: 'sportradar_id' });
    if (error) throw error;
  }

  console.log(`Done. Upserted ${rows.length} games.`);
  return { upserted: rows.length, pre, regular };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seedSchedule().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
