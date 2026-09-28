import { parsePreferences, type Preferences, type WeekGameAirings } from '@pivot/shared';
import type {
  BroadcastCatalog,
  DispatchUser,
  GameCatalog,
  GameSummaryInfo,
  PlayerCatalog,
  PlayerInfo,
  UserDirectory,
  ViewingSessionSnapshot,
} from '@pivot/dispatcher';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import { AIRING_COLUMNS, weekGameAirings } from '../lib/watchOptions.js';
import type { GameDirectory, StaleGame, SeededGame } from './discovery.js';

const ESPN_SEED_PREFIX = 'seed:espn:';

/** `games.season_type` is CHECKed to these three values. */
function parseSeasonType(value: string): StaleGame['seasonType'] {
  if (value === 'pre' || value === 'regular' || value === 'post') return value;
  throw new Error(`unexpected games.season_type ${value}`);
}

export class SupabaseGameDirectory implements GameDirectory {
  constructor(private readonly client: SupabaseServiceClient) {}

  async findByEspnId(espnEventId: string): Promise<SeededGame | null> {
    const { data: game, error } = await this.client
      .from('games')
      .select('id, home_team_id, away_team_id, week, status, scheduled_start')
      .eq('sportradar_id', `${ESPN_SEED_PREFIX}${espnEventId}`)
      .maybeSingle();
    if (error) throw new Error(`games lookup failed: ${error.message}`);
    if (!game) return null;

    const { data: teams, error: teamError } = await this.client
      .from('teams')
      .select('id, abbreviation')
      .in('id', [game.home_team_id, game.away_team_id]);
    if (teamError) throw new Error(`teams lookup failed: ${teamError.message}`);

    const abbrToUuid = new Map<string, string>();
    for (const team of teams ?? []) {
      abbrToUuid.set(team.abbreviation, team.id);
    }
    return {
      id: game.id,
      espnEventId,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      week: game.week,
      status: game.status,
      scheduledStart: game.scheduled_start,
      abbrToUuid,
    };
  }

  async setStatus(gameId: string, status: 'in_progress' | 'final'): Promise<void> {
    const { error } = await this.client.from('games').update({ status }).eq('id', gameId);
    if (error) throw new Error(`games status update failed: ${error.message}`);
  }

  async listInProgress(): Promise<StaleGame[]> {
    const { data, error } = await this.client
      .from('games')
      .select(STALE_GAME_COLUMNS)
      .eq('status', 'in_progress');
    if (error) throw new Error(`in-progress games lookup failed: ${error.message}`);
    return (data ?? []).map(toStaleGame);
  }

  async listStaleScheduled(kickoffBefore: string): Promise<StaleGame[]> {
    const { data, error } = await this.client
      .from('games')
      .select(STALE_GAME_COLUMNS)
      .eq('status', 'scheduled')
      .lt('scheduled_start', kickoffBefore)
      .order('scheduled_start');
    if (error) throw new Error(`stale scheduled games lookup failed: ${error.message}`);
    return (data ?? []).map(toStaleGame);
  }
}

const STALE_GAME_COLUMNS = 'id, sportradar_id, scheduled_start, season_year, season_type, week';

function toStaleGame(row: {
  id: string;
  sportradar_id: string | null;
  scheduled_start: string;
  season_year: number;
  season_type: string;
  week: number;
}): StaleGame {
  return {
    id: row.id,
    espnEventId: row.sportradar_id?.startsWith(ESPN_SEED_PREFIX)
      ? row.sportradar_id.slice(ESPN_SEED_PREFIX.length)
      : null,
    scheduledStart: row.scheduled_start,
    seasonYear: row.season_year,
    seasonType: parseSeasonType(row.season_type),
    week: row.week,
  };
}

export class SupabaseUserDirectory implements UserDirectory {
  constructor(private readonly client: SupabaseServiceClient) {}

  async getUser(userId: string): Promise<DispatchUser | null> {
    const { data, error } = await this.client
      .from('users')
      .select('id, subscription_tier, preferences, expo_push_token')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(`user lookup failed: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      subscriptionTier: data.subscription_tier === 'pro' ? 'pro' : 'free',
      preferences: parsePreferences(data.preferences) satisfies Preferences,
      expoPushToken: data.expo_push_token,
    };
  }

  async getViewingSession(userId: string): Promise<ViewingSessionSnapshot | null> {
    const { data, error } = await this.client
      .from('viewing_sessions')
      .select('primary_game_id, primary_priority_score')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`viewing session lookup failed: ${error.message}`);
    if (!data) return null;
    return {
      primaryGameId: data.primary_game_id,
      primaryPriorityScore: data.primary_priority_score,
    };
  }
}

export class SupabaseGameCatalog implements GameCatalog {
  constructor(private readonly client: SupabaseServiceClient) {}

  async getGameSummary(gameId: string): Promise<GameSummaryInfo | null> {
    const { data: game, error } = await this.client
      .from('games')
      .select('home_team_id, away_team_id')
      .eq('id', gameId)
      .maybeSingle();
    if (error) throw new Error(`game summary lookup failed: ${error.message}`);
    if (!game) return null;

    const { data: teams, error: teamError } = await this.client
      .from('teams')
      .select('id, abbreviation, name, primary_color, secondary_color')
      .in('id', [game.home_team_id, game.away_team_id]);
    if (teamError) throw new Error(`team summary lookup failed: ${teamError.message}`);

    const home = teams?.find((team) => team.id === game.home_team_id);
    const away = teams?.find((team) => team.id === game.away_team_id);
    if (!home || !away) return null;
    return {
      homeTeamAbbreviation: home.abbreviation,
      awayTeamAbbreviation: away.abbreviation,
      homeTeamName: home.name,
      awayTeamName: away.name,
      homeTeamPrimaryColor: home.primary_color,
      homeTeamSecondaryColor: home.secondary_color,
      awayTeamPrimaryColor: away.primary_color,
      awayTeamSecondaryColor: away.secondary_color,
    };
  }
}

/** `game_airings` for the game's week (same week + season type as `GET /games/:id/broadcasts`) and
 *  `user_app_presence` services with `has_subscription = true`. */
export class SupabaseBroadcastCatalog implements BroadcastCatalog {
  constructor(private readonly client: SupabaseServiceClient) {}

  async getWeekAirings(gameId: string): Promise<WeekGameAirings[]> {
    const { data: game, error } = await this.client
      .from('games')
      .select('week, season_type')
      .eq('id', gameId)
      .maybeSingle();
    if (error) throw new Error(`broadcast game lookup failed: ${error.message}`);
    if (!game) return [];

    const { data: week, error: weekError } = await this.client
      .from('games')
      .select('id, scheduled_start')
      .eq('week', game.week)
      .eq('season_type', game.season_type);
    if (weekError) throw new Error(`broadcast week lookup failed: ${weekError.message}`);
    const games = week ?? [];

    const { data: airings, error: airingsError } = await this.client
      .from('game_airings')
      .select(AIRING_COLUMNS)
      .in(
        'game_id',
        games.map((g) => g.id),
      );
    if (airingsError) throw new Error(`game airings lookup failed: ${airingsError.message}`);
    return weekGameAirings(games, airings ?? []);
  }

  async getUserSubscribedServices(userId: string): Promise<ReadonlySet<string>> {
    const { data, error } = await this.client
      .from('user_app_presence')
      .select('service')
      .eq('user_id', userId)
      .eq('has_subscription', true);
    if (error) throw new Error(`app presence lookup failed: ${error.message}`);
    return new Set((data ?? []).map((row) => row.service));
  }
}

export class SupabasePlayerCatalog implements PlayerCatalog {
  constructor(private readonly client: SupabaseServiceClient) {}

  async getPlayers(playerIds: string[]): Promise<PlayerInfo[]> {
    if (playerIds.length === 0) return [];
    const { data, error } = await this.client
      .from('players')
      .select('id, first_name, last_name, position')
      .in('id', playerIds);
    if (error) throw new Error(`player lookup failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      playerId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      position: row.position,
    }));
  }
}
