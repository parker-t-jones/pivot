/**
 * Seeds `public.players` from Sleeper's public players dump (Sprint 3).
 *
 * Sportradar ingestion (Sprint 2) is deferred, so this replaces the originally planned
 * Sportradar backfill (PLAN.md Section 11, Sprint 3 note). `sportradar_id` is left NULL
 * and will be populated when Sprint 2 lands.
 *
 * Idempotent: upserts on `sleeper_id`, safe to re-run (the lineup sync worker re-runs this
 * on every cycle so newly-signed free agents get picked up).
 *
 * Usage: `pnpm seed:players` from the repo root.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Position } from '@roster-remote/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Service role key / URL live in services/api/.env (see services/api/.env.example).
// `quiet: true` suppresses dotenv's console "tip" ads (added in v17+).
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

/** Positions we carry into `players` (Section 7). IDP is out of scope for v1 (Section 4). */
const ALLOWED_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K'];

/**
 * Known mismatches between Sleeper's `team` field on individual players and our
 * `teams.abbreviation` seed (Sprint 1). `null` means the code is historical/defunct and
 * should be dropped rather than mapped — it won't appear on an active roster.
 *
 * Kept as a small static const here (not a DB table): it's tiny, unlikely to change
 * mid-season, and version-controlled alongside the script that uses it.
 */
const SLEEPER_TEAM_ABBREVIATION_OVERRIDES: Record<string, string | null> = {
  LA: 'LAR',
  WAS: 'WAS',
  WSH: 'WAS',
  JAX: 'JAX',
  JAC: 'JAX',
  OAK: null,
  SD: null,
  STL: null,
};

export interface SleeperPlayer {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  active: boolean;
  number: number | null;
}

export type SleeperPlayersResponse = Record<string, SleeperPlayer>;

interface PlayerRow {
  sleeper_id: string;
  first_name: string;
  last_name: string;
  position: Position;
  team_id: string;
  active: boolean;
  jersey_number: number | null;
}

/**
 * Resolves a Sleeper team code to one of our `teams.abbreviation` values.
 * Returns `null` for defunct codes that should be dropped.
 */
export function resolveTeamAbbreviation(sleeperTeam: string): string | null {
  if (sleeperTeam in SLEEPER_TEAM_ABBREVIATION_OVERRIDES) {
    return SLEEPER_TEAM_ABBREVIATION_OVERRIDES[sleeperTeam] ?? null;
  }
  return sleeperTeam;
}

/**
 * True if a Sleeper player entry should be seeded as a `players` row.
 * Excludes free agents (no team), inactive players, and non-fantasy-relevant positions.
 * Team defenses are synthesized separately (`buildDefensePlayerRows`), not sourced from
 * this filter — Sleeper's dump position for them is also `'DEF'`, which is excluded here.
 */
export function isEligibleSleeperPlayer(player: SleeperPlayer): boolean {
  return (
    player.active === true &&
    player.team !== null &&
    player.team !== '' &&
    player.position !== null &&
    (ALLOWED_POSITIONS as readonly string[]).includes(player.position)
  );
}

export function toPlayerRow(
  player: SleeperPlayer,
  teamIdByAbbreviation: ReadonlyMap<string, string>,
): PlayerRow | null {
  if (!player.team) return null;
  const abbreviation = resolveTeamAbbreviation(player.team);
  if (!abbreviation) return null;
  const teamId = teamIdByAbbreviation.get(abbreviation);
  if (!teamId) return null;

  return {
    sleeper_id: player.player_id,
    first_name: player.first_name ?? '',
    last_name: player.last_name ?? '',
    position: player.position as Position,
    team_id: teamId,
    active: true,
    jersey_number: player.number ?? null,
  };
}

/** One synthesized DEF row per team, per Sprint 3 spec — not sourced from the Sleeper dump. */
export function buildDefensePlayerRows(
  teams: readonly { id: string; abbreviation: string }[],
): PlayerRow[] {
  return teams.map((team) => ({
    sleeper_id: team.abbreviation,
    first_name: '',
    last_name: 'Defense',
    position: 'DEF' as Position,
    team_id: team.id,
    active: true,
    jersey_number: null,
  }));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function seedPlayers(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.',
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log(`Fetching teams from ${supabaseUrl}...`);
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, abbreviation');
  if (teamsError) throw teamsError;
  if (!teams || teams.length === 0) {
    throw new Error('No teams found. Run the Sprint 1 teams seed before seeding players.');
  }
  const teamIdByAbbreviation = new Map(teams.map((t) => [t.abbreviation, t.id]));

  console.log(`Fetching player dump from ${SLEEPER_PLAYERS_URL}...`);
  const response = await fetch(SLEEPER_PLAYERS_URL);
  if (!response.ok) {
    throw new Error(`Sleeper players request failed: ${response.status} ${response.statusText}`);
  }
  const sleeperPlayers = (await response.json()) as SleeperPlayersResponse;

  const playerRows: PlayerRow[] = [];
  let skippedInactiveOrFreeAgentOrIneligiblePosition = 0;
  let skippedUnmappedTeam = 0;
  for (const player of Object.values(sleeperPlayers)) {
    if (!isEligibleSleeperPlayer(player)) {
      skippedInactiveOrFreeAgentOrIneligiblePosition++;
      continue;
    }
    const row = toPlayerRow(player, teamIdByAbbreviation);
    if (!row) {
      skippedUnmappedTeam++;
      continue;
    }
    playerRows.push(row);
  }

  const defenseRows = buildDefensePlayerRows(teams);
  const allRows = [...playerRows, ...defenseRows];

  console.log(
    `Upserting ${allRows.length} players (${playerRows.length} individual, ${defenseRows.length} defenses). ` +
      `Skipped ${skippedInactiveOrFreeAgentOrIneligiblePosition} inactive/free-agent/non-fantasy-position, ` +
      `${skippedUnmappedTeam} with unmapped/defunct team codes.`,
  );

  for (const batch of chunk(allRows, 500)) {
    const { error } = await supabase.from('players').upsert(batch, { onConflict: 'sleeper_id' });
    if (error) throw error;
  }

  console.log('Done.');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seedPlayers().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
