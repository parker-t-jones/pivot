import { parsePreferences, type Preferences } from '@pivot/shared';
import type {
  DispatchUser,
  GameCatalog,
  GameSummaryInfo,
  PlayerCatalog,
  PlayerInfo,
  UserDirectory,
  ViewingSessionSnapshot,
} from '@pivot/dispatcher';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import type { GameDirectory, SeededGame } from './discovery.js';

export class SupabaseGameDirectory implements GameDirectory {
  constructor(private readonly client: SupabaseServiceClient) {}

  async findByEspnId(espnEventId: string): Promise<SeededGame | null> {
    const { data: game, error } = await this.client
      .from('games')
      .select('id, home_team_id, away_team_id, week, status, scheduled_start')
      .eq('sportradar_id', `seed:espn:${espnEventId}`)
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
