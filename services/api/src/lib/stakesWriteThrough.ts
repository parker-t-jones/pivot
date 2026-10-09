import type { Json } from './database.types.js';
import { opponentStakesFor, type OpponentStakeSlot } from './opponentStakes.js';
import {
  diffRosteredSet,
  gameIdByTeam,
  rosteredStakesFor,
  sourceForPlatform,
  type RosteredStakeSlot,
  type StakeSetInsert,
  type StoredRosteredStake,
} from './rosteredStakes.js';
import type { SupabaseServiceClient } from './supabase.js';

const IMPOSSIBLE_UUID = '00000000-0000-0000-0000-000000000000';

/** Off unless the process is started with `STAKES_WRITE=1`. */
export function stakesWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['STAKES_WRITE'] === '1';
}

/** Off unless the process is started with `STAKES_READ=1`. */
export function stakesReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['STAKES_READ'] === '1';
}

export function formatStakesReadGuard(): string {
  return '[stakes] STAKES_READ requires STAKES_WRITE; using lineup_slots';
}

export function formatStakesReadFailure(userId: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `[stakes] read failed user=${userId.slice(0, 8)} err=${message}`;
}

export function formatStakesWriteFailure(userId: string, sourceRef: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `[stakes] write-through failed user=${userId.slice(0, 8)} ref=${sourceRef} err=${message}`;
}

function logFailure(userId: string, sourceRef: string, err: unknown): void {
  console.error(formatStakesWriteFailure(userId, sourceRef, err));
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
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

function conditionType(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value['type'] === 'string' ? value['type'] : null;
}

function isRostered(value: Json): boolean {
  return conditionType(value) === 'ROSTERED';
}

function isOpponentRostered(value: Json): boolean {
  return conditionType(value) === 'OPPONENT_ROSTERED';
}

function onePlayer(
  value: { team_id: string; position: string } | { team_id: string; position: string }[] | null,
): { team_id: string; position: string } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function applyDiff(
  supabase: SupabaseServiceClient,
  diff: {
    deleteIds: readonly string[];
    inserts: readonly StakeSetInsert[];
    updates: readonly { id: string; gameId: string; subject: StakeSetInsert['subject'] }[];
  },
): Promise<void> {
  if (diff.deleteIds.length > 0) {
    const { error } = await supabase.from('stakes').delete().in('id', diff.deleteIds);
    if (error) throw error;
  }

  for (const update of diff.updates) {
    const { error } = await supabase
      .from('stakes')
      .update({ game_id: update.gameId, subject: update.subject })
      .eq('id', update.id);
    if (error) throw error;
  }

  if (diff.inserts.length > 0) {
    const { error } = await supabase.from('stakes').insert(diff.inserts.map(toDbInsert));
    if (error) throw error;
  }
}

function toDbInsert(row: StakeSetInsert) {
  return {
    user_id: row.userId,
    season: row.season,
    week: row.week,
    game_id: row.gameId,
    subject: row.subject,
    condition: row.condition,
    source: row.source,
    source_ref: row.sourceRef,
    weight: row.weight,
  };
}

/**
 * Replace this league's ROSTERED stakes for one week. No-ops when `STAKES_WRITE` is off.
 * A failure is logged and swallowed so the roster write that triggered it still succeeds.
 */
export async function writeThroughLeagueStakes(
  supabase: SupabaseServiceClient,
  leagueId: string,
  week: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!stakesWriteEnabled(env)) return;

  let userId = '';
  try {
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, user_id, platform, season_year, lineup_source, fallback_roster')
      .eq('id', leagueId)
      .maybeSingle();
    if (leagueError) throw leagueError;
    if (!league) return;

    userId = league.user_id;
    const source = sourceForPlatform(league.platform);
    if (!source) return;

    const slots = await loadSlots(supabase, league, week);
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('id, home_team_id, away_team_id, season_type')
      .eq('season_year', league.season_year)
      .eq('week', week);
    if (gamesError) throw gamesError;

    const next = rosteredStakesFor(slots, {
      userId: league.user_id,
      season: league.season_year,
      week,
      gameIdByTeamId: gameIdByTeam(
        (games ?? []).map((game) => ({
          id: game.id,
          homeTeamId: game.home_team_id,
          awayTeamId: game.away_team_id,
          seasonType: game.season_type,
        })),
      ),
    });

    const { data: stored, error: storedError } = await supabase
      .from('stakes')
      .select('id, game_id, subject, condition, source')
      .eq('user_id', league.user_id)
      .eq('season', league.season_year)
      .eq('week', week)
      .eq('source', source)
      .eq('source_ref', league.id);
    if (storedError) throw storedError;

    const existing: StoredRosteredStake[] = [];
    for (const row of stored ?? []) {
      if (!isRostered(row.condition) || row.source !== source) continue;
      const subject = readPlayerSubject(row.subject);
      if (!subject) continue;
      existing.push({
        id: row.id,
        playerId: subject.playerId,
        teamId: subject.teamId,
        gameId: row.game_id,
      });
    }

    await applyDiff(supabase, diffRosteredSet(existing, next));
  } catch (err) {
    logFailure(userId, leagueId, err);
  }
}

async function loadSlots(
  supabase: SupabaseServiceClient,
  league: {
    id: string;
    platform: string;
    lineup_source: string | null;
    fallback_roster: Json | null;
  },
  week: number,
): Promise<RosteredStakeSlot[]> {
  if (league.lineup_source === 'roster_fallback') {
    const playerIds = parseIdList(league.fallback_roster);
    const { data, error } = await supabase
      .from('players')
      .select('id, team_id, position')
      .in('id', playerIds.length > 0 ? playerIds : [IMPOSSIBLE_UUID]);
    if (error) throw error;
    const byId = new Map((data ?? []).map((player) => [player.id, player]));
    return playerIds.flatMap((playerId) => {
      const player = byId.get(playerId);
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

  const { data, error } = await supabase
    .from('lineup_slots')
    .select('player_id, slot_type, players(team_id, position)')
    .eq('league_id', league.id)
    .eq('week', week)
    .in('slot_type', ['starter', 'flex']);
  if (error) throw error;

  return (data ?? []).flatMap((slot) => {
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

/**
 * Replace this league's OPPONENT_ROSTERED stakes for one week. Sleeper only.
 * An empty `slots` list deletes that set. No-ops when `STAKES_WRITE` is off.
 * A failure is logged and swallowed so the roster sync still succeeds.
 */
export async function writeThroughOpponentStakes(
  supabase: SupabaseServiceClient,
  leagueId: string,
  week: number,
  slots: readonly OpponentStakeSlot[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!stakesWriteEnabled(env)) return;

  let userId = '';
  try {
    const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('id, user_id, platform, season_year')
      .eq('id', leagueId)
      .maybeSingle();
    if (leagueError) throw leagueError;
    if (!league || league.platform !== 'sleeper') return;

    userId = league.user_id;
    const { data: games, error: gamesError } = await supabase
      .from('games')
      .select('id, home_team_id, away_team_id, season_type')
      .eq('season_year', league.season_year)
      .eq('week', week);
    if (gamesError) throw gamesError;

    const next = opponentStakesFor(slots, {
      userId: league.user_id,
      season: league.season_year,
      week,
      leagueId: league.id,
      gameIdByTeamId: gameIdByTeam(
        (games ?? []).map((game) => ({
          id: game.id,
          homeTeamId: game.home_team_id,
          awayTeamId: game.away_team_id,
          seasonType: game.season_type,
        })),
      ),
    });

    const { data: stored, error: storedError } = await supabase
      .from('stakes')
      .select('id, game_id, subject, condition, source')
      .eq('user_id', league.user_id)
      .eq('season', league.season_year)
      .eq('week', week)
      .eq('source', 'SLEEPER_OPPONENT')
      .eq('source_ref', league.id);
    if (storedError) throw storedError;

    const existing: StoredRosteredStake[] = [];
    for (const row of stored ?? []) {
      if (!isOpponentRostered(row.condition) || row.source !== 'SLEEPER_OPPONENT') continue;
      const subject = readPlayerSubject(row.subject);
      if (!subject) continue;
      existing.push({
        id: row.id,
        playerId: subject.playerId,
        teamId: subject.teamId,
        gameId: row.game_id,
      });
    }

    await applyDiff(supabase, diffRosteredSet(existing, next));
  } catch (err) {
    logFailure(userId, leagueId, err);
  }
}

/** Drop ROSTERED and OPPONENT_ROSTERED stakes whose `source_ref` is this league, across weeks. */
export async function deleteLeagueStakes(
  supabase: SupabaseServiceClient,
  userId: string,
  leagueId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!stakesWriteEnabled(env)) return;

  try {
    const { data, error } = await supabase
      .from('stakes')
      .select('id, condition')
      .eq('user_id', userId)
      .eq('source_ref', leagueId);
    if (error) throw error;
    const ids = (data ?? [])
      .filter((row) => isRostered(row.condition) || isOpponentRostered(row.condition))
      .map((row) => row.id);
    if (ids.length === 0) return;
    const { error: deleteError } = await supabase.from('stakes').delete().in('id', ids);
    if (deleteError) throw deleteError;
  } catch (err) {
    logFailure(userId, leagueId, err);
  }
}
