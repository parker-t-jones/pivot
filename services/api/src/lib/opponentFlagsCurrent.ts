import { evaluateOpponentRostered, type EvaluatorContext, type Stake } from '@pivot/engine';
import type { GameState, Preferences, UserLineupCache } from '@pivot/shared';
import { assembleUserLineupCache, type CachePlayerRow } from './lineupCacheAssemble.js';
import type { Json } from './database.types.js';
import type { SupabaseServiceClient } from './supabase.js';
import { resolveWatchedLeagueIds } from './watched-leagues.js';

const STAKE_SOURCES = [
  'SLEEPER_ROSTER',
  'SLEEPER_OPPONENT',
  'MANUAL',
  'KALSHI_MARKET',
  'SHARED_LIST',
] as const;

export interface OpponentFlagPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
}

/** One opponent red-zone game. `players` carries the names Home prints on the chip. */
export interface OpponentFlagCurrent {
  game_id: string;
  priority_score: 1;
  player_ids: string[];
  reasons: ['red_zone'];
  players: OpponentFlagPlayer[];
}

export interface OpponentFlagsCurrent {
  opponent_flags: OpponentFlagCurrent[];
  opponent_game_ids: string[];
}

interface StakeMeta {
  id: string;
  season: number;
  source: Stake['source'];
  sourceRef: string;
  weight: number;
  createdAt: string;
  firstName: string;
  lastName: string;
}

interface PickedStake {
  leagueId: string;
  playerId: string;
  meta: Omit<StakeMeta, 'firstName' | 'lastName'>;
}

/**
 * This week's opponent starters for the user's watched leagues, evaluated on read.
 * Never enqueues a flag event and never sends a push.
 */
export async function loadOpponentRedZone(input: {
  supabase: SupabaseServiceClient;
  getGameState: (gameId: string) => Promise<GameState | null>;
  userId: string;
  week: number;
  preferences: Preferences;
  subscriptionTier: string;
  excludeGameIds: ReadonlySet<string>;
}): Promise<OpponentFlagsCurrent> {
  const empty: OpponentFlagsCurrent = { opponent_flags: [], opponent_game_ids: [] };

  const { data: leagues, error: leaguesError } = await input.supabase
    .from('leagues')
    .select('id, season_year')
    .eq('user_id', input.userId)
    .order('created_at', { ascending: true });
  if (leaguesError) throw leaguesError;

  const owned = leagues ?? [];
  const watchedIds = resolveWatchedLeagueIds({
    preferences: input.preferences,
    subscriptionTier: input.subscriptionTier,
    ownedLeagueIds: owned.map((league) => league.id),
  });
  const watched = owned.filter((league) => watchedIds.includes(league.id));
  if (watched.length === 0) return empty;

  const seasonByLeague = new Map(watched.map((league) => [league.id, league.season_year]));
  const { data: stakeRows, error: stakesError } = await input.supabase
    .from('stakes')
    .select('id, user_id, season, week, subject, condition, source, source_ref, weight, created_at')
    .eq('user_id', input.userId)
    .eq('week', input.week)
    .in(
      'source_ref',
      watched.map((league) => league.id),
    );
  if (stakesError) throw stakesError;

  const picked: PickedStake[] = [];
  for (const row of stakeRows ?? []) {
    if (row.user_id !== input.userId || row.week !== input.week) continue;
    if (!isOpponentRostered(row.condition) || row.source_ref === null) continue;
    const season = seasonByLeague.get(row.source_ref);
    const source = stakeSource(row.source);
    const playerId = readPlayerId(row.subject);
    if (season === undefined || source === null || playerId === null || row.season !== season) {
      continue;
    }
    picked.push({
      leagueId: row.source_ref,
      playerId,
      meta: {
        id: row.id,
        season: row.season,
        source,
        sourceRef: row.source_ref,
        weight: row.weight,
        createdAt: row.created_at,
      },
    });
  }
  if (picked.length === 0) return empty;

  const playerIds = [...new Set(picked.map((row) => row.playerId))];
  const { data: playerRows, error: playersError } = await input.supabase
    .from('players')
    .select('id, team_id, position, first_name, last_name')
    .in('id', playerIds);
  if (playersError) throw playersError;
  const playersById = new Map((playerRows ?? []).map((player) => [player.id, player]));

  const cacheRows: CachePlayerRow[] = [];
  const metaByPlayer = new Map<string, StakeMeta>();
  for (const item of picked) {
    const player = playersById.get(item.playerId);
    if (!player || metaByPlayer.has(item.playerId)) continue;
    cacheRows.push({
      playerId: player.id,
      teamId: player.team_id,
      position: player.position,
      star: false,
      leagueId: item.leagueId,
    });
    metaByPlayer.set(item.playerId, {
      ...item.meta,
      firstName: player.first_name,
      lastName: player.last_name,
    });
  }
  if (cacheRows.length === 0) return empty;

  const cache = assembleUserLineupCache(input.userId, input.week, cacheRows);
  const teamIds = [...new Set(cache.playerToTeam.values())];
  const { data: gameRows, error: gamesError } = await input.supabase
    .from('games')
    .select('id, home_team_id, away_team_id')
    .eq('week', input.week)
    .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`);
  if (gamesError) throw gamesError;

  const teamIdSet = new Set(teamIds);
  const games = [...new Map((gameRows ?? []).map((game) => [game.id, game])).values()]
    .filter((game) => teamIdSet.has(game.home_team_id) || teamIdSet.has(game.away_team_id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const emptyLineup: UserLineupCache = {
    userId: input.userId,
    week: input.week,
    teamPositions: new Map(),
    playerToTeam: new Map(),
    starPlayerIds: new Set(),
  };
  const triggered = new Map<string, Set<string>>();
  for (const game of games) {
    const state = await input.getGameState(game.id);
    if (!state) continue;
    const ctx: EvaluatorContext = {
      gameId: game.id,
      game: state,
      lineup: emptyLineup,
      opponent: cache,
    };
    for (const [playerId, teamId] of cache.playerToTeam) {
      if (teamId !== game.home_team_id && teamId !== game.away_team_id) continue;
      const meta = metaByPlayer.get(playerId);
      if (!meta) continue;
      const triggers = evaluateOpponentRostered(
        toStake(input.userId, input.week, meta, playerId, teamId, game.id),
        ctx,
      );
      if (!triggers.some((trigger) => trigger.code === 'OPP_RED_ZONE')) continue;
      const ids = triggered.get(game.id) ?? new Set<string>();
      ids.add(playerId);
      triggered.set(game.id, ids);
    }
  }

  const opponent_flags: OpponentFlagCurrent[] = [...triggered.entries()]
    .filter(([gameId]) => !input.excludeGameIds.has(gameId))
    .map(([gameId, ids]) => {
      const player_ids = [...ids].sort((a, b) => a.localeCompare(b));
      const flag: OpponentFlagCurrent = {
        game_id: gameId,
        priority_score: 1,
        player_ids,
        reasons: ['red_zone'],
        players: player_ids.flatMap((playerId) => {
          const meta = metaByPlayer.get(playerId);
          return meta
            ? [{ player_id: playerId, first_name: meta.firstName, last_name: meta.lastName }]
            : [];
        }),
      };
      return flag;
    })
    .sort((a, b) => a.game_id.localeCompare(b.game_id));

  return {
    opponent_flags,
    opponent_game_ids: games.map((game) => game.id),
  };
}

function toStake(
  userId: string,
  week: number,
  meta: StakeMeta,
  playerId: string,
  teamId: string,
  gameId: string,
): Stake {
  return {
    id: meta.id,
    userId,
    season: meta.season,
    week,
    gameId,
    subject: { type: 'PLAYER', playerId, teamId },
    condition: { type: 'OPPONENT_ROSTERED' },
    source: meta.source,
    sourceRef: meta.sourceRef,
    weight: meta.weight,
    createdAt: meta.createdAt,
  };
}

function isOpponentRostered(value: Json): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value['type'] === 'OPPONENT_ROSTERED'
  );
}

function readPlayerId(value: Json): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const playerId = value['playerId'];
  if (value['type'] !== 'PLAYER' || typeof playerId !== 'string' || playerId.length === 0) {
    return null;
  }
  return playerId;
}

function stakeSource(value: string): Stake['source'] | null {
  return (STAKE_SOURCES as readonly string[]).includes(value) ? (value as Stake['source']) : null;
}
