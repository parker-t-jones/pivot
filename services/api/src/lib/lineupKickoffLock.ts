import { ApiError } from './errors.js';
import { gameHasKickedOff } from './kickoff.js';
import type { SupabaseServiceClient } from './supabase.js';

interface WeekGame {
  home_team_id: string;
  away_team_id: string;
  status: string;
  scheduled_start: string;
}

/**
 * Manual lineups: a player whose game has kicked off stays on the week's lineup until the
 * week rolls over. Otherwise a free user could swap started players out and keep tracking
 * new ones under the player cap. Adding players, moving a player between slots, and
 * removing a player whose game has not started are all still allowed.
 */
export async function assertStartedPlayersKept(
  supabase: SupabaseServiceClient,
  input: {
    leagueId: string;
    season: number;
    week: number;
    nextPlayerIds: readonly string[];
    now: Date;
  },
): Promise<void> {
  const { data: current, error: currentError } = await supabase
    .from('lineup_slots')
    .select('player_id')
    .eq('league_id', input.leagueId)
    .eq('week', input.week);
  if (currentError) throw currentError;

  const kept = new Set(input.nextPlayerIds);
  const removed = [
    ...new Set(((current ?? []) as { player_id: string }[]).map((slot) => slot.player_id)),
  ].filter((id) => !kept.has(id));
  if (removed.length === 0) return;

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, team_id')
    .in('id', removed);
  if (playersError) throw playersError;

  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('home_team_id, away_team_id, status, scheduled_start')
    .eq('season_year', input.season)
    .eq('week', input.week)
    .eq('season_type', 'regular');
  if (gamesError) throw gamesError;

  const startedTeams = new Set<string>();
  for (const game of (games ?? []) as WeekGame[]) {
    if (!gameHasKickedOff(game, input.now)) continue;
    startedTeams.add(game.home_team_id);
    startedTeams.add(game.away_team_id);
  }

  const locked = ((players ?? []) as { id: string; team_id: string | null }[])
    .filter((player) => player.team_id !== null && startedTeams.has(player.team_id))
    .map((player) => player.id);
  if (locked.length > 0) {
    throw new ApiError(
      409,
      'lineup_player_locked',
      locked.length === 1
        ? 'This player is locked because the game has started.'
        : 'These players are locked because their games have started.',
      { player_ids: locked },
    );
  }
}
