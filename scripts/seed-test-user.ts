/**
 * Seeds a fully-realized local test user (Sprint 9 Phase 3 infra hygiene) so a developer can go
 * from an empty local Supabase straight to "signed in, with a real lineup" without walking the
 * onboarding flow by hand every time the DB gets reset.
 *
 * Creates/updates, in order:
 *  - An `auth.users` row with a fixed, known email/password (via the Admin API — `handle_new_user`
 *    then auto-creates the matching `public.users` row, per Section 7).
 *  - One `manual` `leagues` row owned by that user.
 *  - A `lineup_slots` roster for the *current* NFL week (Sleeper's `/v1/state/nfl` — the same
 *    source `services/api`'s `getCurrentNflState` reads — so the seeded week matches whatever
 *    `GET /leagues/:id/lineup` returns with no `?week=` override). One starter is marked
 *    `is_star: true` to exercise the Sprint 9 Phase 2 star-player data layer.
 *  - Two `user_app_presence` rows so the Settings screen's streaming section has something to show.
 *
 * Deliberately does NOT seed `games`/`game_broadcasts` — there's no real schedule data behind a
 * fixture game yet (Sportradar ingestion is still deferred), and Sprint 10 is already adding a
 * schedule endpoint for live-game Home states. Fabricating a fake game here would either duplicate
 * that work or drift from it. `pnpm seed:broadcasts` remains the way to backfill broadcasts once
 * real games exist.
 *
 * Requires `pnpm seed:players` to have been run first (reads `public.players`/`public.teams`).
 *
 * Idempotent: re-running finds the existing user by email, resets its password to the known
 * fixture value (in case it drifted), reuses the existing "Test League", and upserts lineup
 * slots / app-presence rows rather than duplicating them.
 *
 * Usage: `pnpm seed:test-user` from the repo root.
 * Override the fixture identity with `SEED_TEST_USER_EMAIL` / `SEED_TEST_USER_PASSWORD`.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Position, SlotType } from '@fantasy-focus/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../services/api/.env'), quiet: true });

const SLEEPER_STATE_URL = 'https://api.sleeper.app/v1/state/nfl';

const TEST_EMAIL = process.env['SEED_TEST_USER_EMAIL'] ?? 'test@fantasyfocus.dev';
const TEST_PASSWORD = process.env['SEED_TEST_USER_PASSWORD'] ?? 'FantasyFocusTest123!';
const TEST_LEAGUE_NAME = 'Test League';

interface SleeperNflState {
  week: number;
  season: string;
  season_type: 'pre' | 'regular' | 'post' | 'off';
}

/** One slot per roster spot. `flex` pulls from whichever RB/WR/TE wasn't already used as a starter. */
interface RosterSpec {
  positionInLineup: string;
  slotType: SlotType;
  eligiblePositions: readonly Position[];
  isStar?: true;
}

const ROSTER_SPEC: readonly RosterSpec[] = [
  { positionInLineup: 'QB', slotType: 'starter', eligiblePositions: ['QB'] },
  { positionInLineup: 'RB1', slotType: 'starter', eligiblePositions: ['RB'] },
  { positionInLineup: 'RB2', slotType: 'starter', eligiblePositions: ['RB'] },
  { positionInLineup: 'WR1', slotType: 'starter', eligiblePositions: ['WR'], isStar: true },
  { positionInLineup: 'WR2', slotType: 'starter', eligiblePositions: ['WR'] },
  { positionInLineup: 'TE', slotType: 'starter', eligiblePositions: ['TE'] },
  { positionInLineup: 'FLEX', slotType: 'flex', eligiblePositions: ['RB', 'WR', 'TE'] },
  { positionInLineup: 'K', slotType: 'starter', eligiblePositions: ['K'] },
  { positionInLineup: 'DEF', slotType: 'starter', eligiblePositions: ['DEF'] },
  { positionInLineup: 'BENCH1', slotType: 'bench', eligiblePositions: ['RB', 'WR', 'TE'] },
  { positionInLineup: 'BENCH2', slotType: 'bench', eligiblePositions: ['RB', 'WR', 'TE'] },
];

interface RosterPlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  position: Position;
}

/**
 * Deterministically assigns one player per roster spot, in `ROSTER_SPEC` order, picking the
 * lowest-id not-yet-used player eligible for that spot. Deterministic (not random) so re-running
 * the script against an unchanged `players` table always seeds the exact same roster — required
 * for the upsert-based idempotency below to actually converge instead of accumulating bench slots.
 */
export function assignRoster(
  spec: readonly RosterSpec[],
  players: readonly RosterPlayerRow[],
): Map<RosterSpec, RosterPlayerRow> {
  const byPosition = new Map<Position, RosterPlayerRow[]>();
  for (const player of players) {
    const list = byPosition.get(player.position) ?? [];
    list.push(player);
    byPosition.set(player.position, list);
  }
  for (const list of byPosition.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const used = new Set<string>();
  const assignment = new Map<RosterSpec, RosterPlayerRow>();
  for (const spot of spec) {
    for (const position of spot.eligiblePositions) {
      const candidate = (byPosition.get(position) ?? []).find((player) => !used.has(player.id));
      if (candidate) {
        assignment.set(spot, candidate);
        used.add(candidate.id);
        break;
      }
    }
  }
  return assignment;
}

const POSTGREST_PAGE_SIZE = 1000;

/**
 * Fetches every QB/RB/WR/TE/K/DEF row, paginating past the local stack's `[api] max_rows = 1000`
 * (`supabase/config.toml`) hard cap — a `.limit()` above that value is silently clamped back down
 * by PostgREST, so a single unpaginated `select()` here would truncate the result. With ~1,000
 * individual players plus 32 synthesized DEF rows (`seed-players.ts` appends DEF last), an
 * unpaginated fetch reliably drops the DEF slot's only candidates without surfacing an error.
 */
async function fetchAllPlayers(supabase: SupabaseClient): Promise<RosterPlayerRow[]> {
  const rows: RosterPlayerRow[] = [];
  for (let offset = 0; ; offset += POSTGREST_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('players')
      .select('id, first_name, last_name, position')
      .in('position', ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
      .range(offset, offset + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as RosterPlayerRow[]));
    if (data.length < POSTGREST_PAGE_SIZE) break;
  }
  return rows;
}

async function getCurrentNflWeek(): Promise<number> {
  const response = await fetch(SLEEPER_STATE_URL);
  if (!response.ok) {
    throw new Error(`Sleeper state request failed: ${response.status} ${response.statusText}`);
  }
  const state = (await response.json()) as SleeperNflState;
  return state.week;
}

export async function seedTestUser(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in services/api/.env.');
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log(`Looking up existing test user ${TEST_EMAIL}...`);
  const { data: existingUser, error: existingUserError } = await supabase
    .from('users')
    .select('id')
    .eq('email', TEST_EMAIL)
    .maybeSingle();
  if (existingUserError) throw existingUserError;

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    console.log(`Found existing user ${userId}. Resetting password to the fixture value...`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: TEST_PASSWORD,
    });
    if (updateError) throw updateError;
  } else {
    console.log('No existing user found. Creating one...');
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createError) throw createError;
    if (!created.user) throw new Error('createUser succeeded but returned no user.');
    userId = created.user.id;
  }

  console.log(`Looking up existing "${TEST_LEAGUE_NAME}"...`);
  const { data: existingLeague, error: existingLeagueError } = await supabase
    .from('leagues')
    .select('id')
    .eq('user_id', userId)
    .eq('name', TEST_LEAGUE_NAME)
    .maybeSingle();
  if (existingLeagueError) throw existingLeagueError;

  console.log('Fetching current NFL week from Sleeper (same source services/api uses)...');
  const week = await getCurrentNflWeek();
  const seasonYear = new Date().getUTCFullYear();

  let leagueId: string;
  if (existingLeague) {
    leagueId = existingLeague.id;
    console.log(`Found existing league ${leagueId}.`);
  } else {
    console.log('Creating "Test League"...');
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .insert({
        user_id: userId,
        platform: 'manual',
        name: TEST_LEAGUE_NAME,
        sport: 'nfl',
        season_year: seasonYear,
        last_synced_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (leagueError) throw leagueError;
    leagueId = league.id;
  }

  console.log('Fetching eligible players (QB/RB/WR/TE/K/DEF)...');
  const players = await fetchAllPlayers(supabase);
  if (players.length === 0) {
    throw new Error('No players found. Run `pnpm seed:players` before seeding a test user.');
  }

  const roster = assignRoster(ROSTER_SPEC, players as RosterPlayerRow[]);
  if (roster.size < ROSTER_SPEC.length) {
    console.warn(
      `Only filled ${roster.size}/${ROSTER_SPEC.length} roster spots — the players table doesn't ` +
        'have enough eligible players at every position. Re-run `pnpm seed:players` if this looks wrong.',
    );
  }

  console.log(`Upserting ${roster.size} lineup slots for week ${week}...`);
  const rows = Array.from(roster.entries()).map(([spot, player]) => ({
    league_id: leagueId,
    week,
    player_id: player.id,
    slot_type: spot.slotType,
    position_in_lineup: spot.positionInLineup,
    is_star: spot.isStar ?? false,
  }));
  const { error: slotsError } = await supabase
    .from('lineup_slots')
    .upsert(rows, { onConflict: 'league_id,week,player_id' });
  if (slotsError) throw slotsError;

  console.log('Upserting streaming-service presence (ESPN+ subscribed, Fox not)...');
  const { error: presenceError } = await supabase.from('user_app_presence').upsert(
    [
      { user_id: userId, service: 'espn_plus', has_subscription: true },
      { user_id: userId, service: 'fox', has_subscription: false },
    ],
    { onConflict: 'user_id,service' },
  );
  if (presenceError) throw presenceError;

  console.log('\nDone. Sign in with:');
  console.log(`  email:    ${TEST_EMAIL}`);
  console.log(`  password: ${TEST_PASSWORD}`);
  console.log(`League: ${leagueId} (week ${week}, ${roster.size} roster spots, 1 star player)`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  seedTestUser().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
