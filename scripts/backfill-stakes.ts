/**
 * One-time ROSTERED stake backfill from leagues already in the database.
 *
 * Dry-run unless `--apply` is passed. Re-running `--apply` changes nothing.
 * Refuses any non-local `SUPABASE_URL`, including with `--allow-remote`.
 *
 * Matchup leagues: one set per stored `lineup_slots` week (starter and flex).
 * `roster_fallback` leagues: those players as starters, for each week that league
 * already has slots. A fallback league with no stored week is skipped.
 * A team in zero regular-season games that week is a bye.
 * A team in more than one regular-season game is logged and skipped.
 *
 * Usage:
 *   pnpm backfill:stakes
 *   pnpm backfill:stakes -- --apply
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../services/api/src/lib/database.types.js';
import {
  diffRosteredSet,
  gameIdByTeam,
  rosteredStakesFor,
  sourceForPlatform,
  type RosteredSetDiff,
  type RosteredStakeInsert,
  type RosteredStakeSlot,
  type StoredRosteredStake,
} from '../services/api/src/lib/rosteredStakes.js';
import { bootstrapSeedScript, RemoteSafetyError } from './remoteSafety.js';

const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000';

export function parseBackfillArgs(argv: readonly string[]): { apply: boolean } {
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    throw new RemoteSafetyError(`backfill-stakes: unknown argument ${arg}`);
  }
  return { apply };
}

interface UserTally {
  userId: string;
  stakes: number;
  insert: number;
  update: number;
  delete: number;
}

export function formatBackfillReport(tallies: readonly UserTally[], dryRun: boolean): string {
  const prefix = dryRun ? '[stakes] dry-run' : '[stakes]';
  const lines = [...tallies]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map(
      (row) =>
        `${prefix} user=${row.userId} stakes=${row.stakes} insert=${row.insert} update=${row.update} delete=${row.delete}`,
    );
  const total = tallies.reduce(
    (sum, row) => ({
      users: sum.users + 1,
      stakes: sum.stakes + row.stakes,
      insert: sum.insert + row.insert,
      update: sum.update + row.update,
      delete: sum.delete + row.delete,
    }),
    { users: 0, stakes: 0, insert: 0, update: 0, delete: 0 },
  );
  lines.push(
    `${prefix} total users=${total.users} stakes=${total.stakes} insert=${total.insert} update=${total.update} delete=${total.delete}`,
  );
  return lines.join('\n');
}

interface LeagueRow {
  id: string;
  user_id: string;
  platform: string;
  season_year: number;
  lineup_source: string | null;
  fallback_roster: Json | null;
}

interface SlotRow {
  league_id: string;
  week: number;
  player_id: string;
  slot_type: string;
  players: { team_id: string; position: string } | { team_id: string; position: string }[] | null;
}

interface GameRow {
  id: string;
  season_year: number;
  week: number;
  season_type: string;
  home_team_id: string;
  away_team_id: string;
}

interface StakeRow {
  id: string;
  user_id: string;
  season: number;
  week: number;
  game_id: string;
  source: string;
  source_ref: string | null;
  subject: Json;
  condition: Json;
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function onePlayer(value: SlotRow['players']): { team_id: string; position: string } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function readPlayerSubject(value: Json): { playerId: string; teamId: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const playerId = value['playerId'];
  const teamId = value['teamId'];
  if (value['type'] !== 'PLAYER' || typeof playerId !== 'string' || typeof teamId !== 'string') {
    return null;
  }
  return { playerId, teamId };
}

function isRostered(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value['type'] === 'ROSTERED'
  );
}

interface WeekPlan {
  userId: string;
  season: number;
  week: number;
  sourceRef: string;
  next: RosteredStakeInsert[];
  existing: StoredRosteredStake[];
  diff: RosteredSetDiff;
}

function weeksForLeague(league: LeagueRow, slots: readonly SlotRow[]): number[] {
  return [
    ...new Set(slots.filter((slot) => slot.league_id === league.id).map((slot) => slot.week)),
  ].sort((a, b) => a - b);
}

function slotsForWeek(
  league: LeagueRow,
  week: number,
  slots: readonly SlotRow[],
  playersById: ReadonlyMap<string, { id: string; team_id: string; position: string }>,
): RosteredStakeSlot[] {
  if (league.lineup_source === 'roster_fallback') {
    return parseIdList(league.fallback_roster).flatMap((playerId) => {
      const player = playersById.get(playerId);
      if (!player) return [];
      return [
        {
          playerId: player.id,
          teamId: player.team_id,
          position: player.position,
          slotType: 'starter',
          leagueId: league.id,
          platform: league.platform,
          lineupSource: league.lineup_source,
        },
      ];
    });
  }

  return slots.flatMap((slot) => {
    if (slot.league_id !== league.id || slot.week !== week) return [];
    const player = onePlayer(slot.players);
    if (!player) return [];
    return [
      {
        playerId: slot.player_id,
        teamId: player.team_id,
        position: player.position,
        slotType: slot.slot_type,
        leagueId: league.id,
        platform: league.platform,
        lineupSource: league.lineup_source,
      },
    ];
  });
}

export function planBackfill(input: {
  leagues: readonly LeagueRow[];
  slots: readonly SlotRow[];
  games: readonly GameRow[];
  stakes: readonly StakeRow[];
  playersById: ReadonlyMap<string, { id: string; team_id: string; position: string }>;
}): { plans: WeekPlan[]; skipped: string[] } {
  const plans: WeekPlan[] = [];
  const skipped: string[] = [];

  for (const league of input.leagues) {
    const source = sourceForPlatform(league.platform);
    if (!source) {
      skipped.push(`skipped league=${league.id} platform=${league.platform}`);
      continue;
    }
    const weeks = weeksForLeague(league, input.slots);
    if (league.lineup_source === 'roster_fallback' && weeks.length === 0) {
      skipped.push(`skipped fallback league=${league.id} (no stored week)`);
      continue;
    }
    if (weeks.length === 0) continue;

    for (const week of weeks) {
      const weekGames = input.games.filter(
        (game) => game.season_year === league.season_year && game.week === week,
      );
      const next = rosteredStakesFor(slotsForWeek(league, week, input.slots, input.playersById), {
        userId: league.user_id,
        season: league.season_year,
        week,
        gameIdByTeamId: gameIdByTeam(
          weekGames.map((game) => ({
            id: game.id,
            homeTeamId: game.home_team_id,
            awayTeamId: game.away_team_id,
            seasonType: game.season_type,
          })),
        ),
      });
      const existing: StoredRosteredStake[] = [];
      for (const stake of input.stakes) {
        if (stake.user_id !== league.user_id || stake.season !== league.season_year) continue;
        if (stake.week !== week || stake.source !== source || stake.source_ref !== league.id)
          continue;
        if (!isRostered(stake.condition)) continue;
        const subject = readPlayerSubject(stake.subject);
        if (!subject) continue;
        existing.push({
          id: stake.id,
          playerId: subject.playerId,
          teamId: subject.teamId,
          gameId: stake.game_id,
        });
      }
      plans.push({
        userId: league.user_id,
        season: league.season_year,
        week,
        sourceRef: league.id,
        next,
        existing,
        diff: diffRosteredSet(existing, next),
      });
    }
  }

  return { plans, skipped };
}

function talliesFor(plans: readonly WeekPlan[]): UserTally[] {
  const byUser = new Map<string, UserTally>();
  for (const plan of plans) {
    const tally = byUser.get(plan.userId) ?? {
      userId: plan.userId,
      stakes: 0,
      insert: 0,
      update: 0,
      delete: 0,
    };
    tally.stakes += plan.next.length;
    tally.insert += plan.diff.inserts.length;
    tally.update += plan.diff.updates.length;
    tally.delete += plan.diff.deleteIds.length;
    byUser.set(plan.userId, tally);
  }
  return [...byUser.values()];
}

async function applyPlans(
  supabase: SupabaseClient<Database>,
  plans: readonly WeekPlan[],
): Promise<void> {
  for (const plan of plans) {
    if (plan.diff.deleteIds.length > 0) {
      const { error } = await supabase.from('stakes').delete().in('id', plan.diff.deleteIds);
      if (error) throw error;
    }
    for (const update of plan.diff.updates) {
      const { error } = await supabase
        .from('stakes')
        .update({ game_id: update.gameId, subject: update.subject })
        .eq('id', update.id);
      if (error) throw error;
    }
    if (plan.diff.inserts.length > 0) {
      const { error } = await supabase.from('stakes').insert(
        plan.diff.inserts.map((row) => ({
          user_id: row.userId,
          season: row.season,
          week: row.week,
          game_id: row.gameId,
          subject: row.subject,
          condition: row.condition,
          source: row.source,
          source_ref: row.sourceRef,
          weight: row.weight,
        })),
      );
      if (error) throw error;
    }
  }
}

async function main(): Promise<void> {
  const cli = bootstrapSeedScript({
    scriptName: 'backfill-stakes',
    forbidRemoteAlways: true,
  });
  const { apply } = parseBackfillArgs(cli.rest);
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!supabaseUrl || !serviceRoleKey) {
    throw new RemoteSafetyError(
      'backfill-stakes: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [leaguesResult, slotsResult, gamesResult, stakesResult] = await Promise.all([
    supabase
      .from('leagues')
      .select('id, user_id, platform, season_year, lineup_source, fallback_roster'),
    supabase
      .from('lineup_slots')
      .select('league_id, week, player_id, slot_type, players(team_id, position)'),
    supabase.from('games').select('id, season_year, week, season_type, home_team_id, away_team_id'),
    supabase
      .from('stakes')
      .select('id, user_id, season, week, game_id, source, source_ref, subject, condition'),
  ]);
  if (leaguesResult.error) throw leaguesResult.error;
  if (slotsResult.error) throw slotsResult.error;
  if (gamesResult.error) throw gamesResult.error;
  if (stakesResult.error) throw stakesResult.error;

  const leagues = leaguesResult.data ?? [];
  const fallbackIds = [
    ...new Set(
      leagues
        .filter((league) => league.lineup_source === 'roster_fallback')
        .flatMap((league) => parseIdList(league.fallback_roster)),
    ),
  ];
  const playersResult =
    fallbackIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('players')
          .select('id, team_id, position')
          .in('id', fallbackIds.length > 0 ? fallbackIds : [IMPOSSIBLE_UUID]);
  if (playersResult.error) throw playersResult.error;

  const { plans, skipped } = planBackfill({
    leagues,
    slots: (slotsResult.data ?? []) as SlotRow[],
    games: gamesResult.data ?? [],
    stakes: stakesResult.data ?? [],
    playersById: new Map((playersResult.data ?? []).map((player) => [player.id, player])),
  });

  const prefix = apply ? '[stakes]' : '[stakes] dry-run';
  for (const line of skipped) console.log(`${prefix} ${line}`);
  console.log(formatBackfillReport(talliesFor(plans), !apply));
  if (!apply) {
    console.log('[stakes] dry-run only. Re-run with --apply to write.');
    return;
  }
  await applyPlans(supabase, plans);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err: unknown) => {
    if (err instanceof RemoteSafetyError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(err);
    process.exit(1);
  });
}
