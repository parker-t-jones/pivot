import * as engine from '@pivot/engine';
import type { Stake } from '@pivot/engine';
import { formatStakeLabel, type StakeTeam } from '@pivot/shared/stakeLabel';
import type { GameState, UserLineupCache } from '@pivot/shared';
import type { GameSummaryInfo } from '@pivot/dispatcher';
import { isBetCondition } from './betIndex.js';
import type { Json } from './database.types.js';
import type { SupabaseServiceClient } from './supabase.js';

const STAKE_SOURCES = new Set<Stake['source']>([
  'SLEEPER_ROSTER',
  'SLEEPER_OPPONENT',
  'MANUAL',
  'KALSHI_MARKET',
  'SHARED_LIST',
]);

const EMPTY_LINEUP: UserLineupCache = {
  userId: '',
  week: 0,
  teamPositions: new Map(),
  playerToTeam: new Map(),
  starPlayerIds: new Set(),
};

export interface BetChip {
  stake_id: string;
  label: string;
}

export interface BetGameView {
  gameState: GameState;
  info: GameSummaryInfo;
}

/** Firing bets for games that should appear on Home, plus every bet game id this week. */
export interface WeekBets {
  gameIds: string[];
  byGame: Map<string, { score: number; bets: BetChip[] }>;
  games: Map<string, BetGameView>;
}

interface StakeRow {
  id: string;
  user_id: string;
  season: number;
  week: number;
  game_id: string;
  subject: Json;
  condition: Json;
  source: string;
  weight: number;
  created_at: string;
}

interface GameRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
}

interface TeamRow {
  id: string;
  abbreviation: string;
  name: string;
  primary_color: string;
  secondary_color: string;
}

export function betPriorityScore(leverage: number): number {
  return Math.max(1, Math.round(leverage * 12));
}

export async function loadWeekBets(input: {
  supabase: SupabaseServiceClient;
  getGameState: (gameId: string) => Promise<GameState | null>;
  userId: string;
  week: number;
  gameIds: readonly string[];
}): Promise<WeekBets | null> {
  const wanted = new Set(input.gameIds);
  if (wanted.size === 0) return null;

  const { data, error } = await input.supabase
    .from('stakes')
    .select('id, user_id, season, week, game_id, subject, condition, source, weight, created_at')
    .eq('user_id', input.userId)
    .eq('week', input.week)
    .in('game_id', [...wanted]);
  if (error) throw new Error(error.message);

  const stakes = ((data ?? []) as StakeRow[])
    .filter(
      (row) =>
        row.user_id === input.userId &&
        row.week === input.week &&
        wanted.has(row.game_id) &&
        isBetCondition(row.condition),
    )
    .flatMap((row) => {
      const stake = toStake(row);
      return stake ? [stake] : [];
    });
  if (stakes.length === 0) return null;

  const gameIds = [...new Set(stakes.map((stake) => stake.gameId))].sort((a, b) =>
    a.localeCompare(b),
  );
  const { data: gameData, error: gamesError } = await input.supabase
    .from('games')
    .select('id, home_team_id, away_team_id')
    .in('id', gameIds);
  if (gamesError) throw new Error(gamesError.message);
  const games = new Map(
    ((gameData ?? []) as GameRow[])
      .filter((game) => gameIds.includes(game.id))
      .map((game) => [game.id, game]),
  );

  const teamIds = [
    ...new Set([...games.values()].flatMap((game) => [game.home_team_id, game.away_team_id])),
  ];
  const teams = new Map<string, TeamRow>();
  if (teamIds.length > 0) {
    const { data: teamData, error: teamsError } = await input.supabase
      .from('teams')
      .select('id, abbreviation, name, primary_color, secondary_color')
      .in('id', teamIds);
    if (teamsError) throw new Error(teamsError.message);
    for (const team of (teamData ?? []) as TeamRow[]) {
      if (teamIds.includes(team.id)) teams.set(team.id, team);
    }
  }
  const labelTeams: StakeTeam[] = [...teams.values()].map((team) => ({
    teamId: team.id,
    abbreviation: team.abbreviation,
  }));

  const byGame = new Map<string, { leverage: number; bets: BetChip[] }>();
  const views = new Map<string, BetGameView>();
  const stateByGame = new Map<string, GameState | null>();

  for (const stake of stakes) {
    let gameState = stateByGame.get(stake.gameId);
    if (gameState === undefined) {
      gameState = await input.getGameState(stake.gameId);
      stateByGame.set(stake.gameId, gameState);
    }
    if (!gameState || gameState.status === 'final') continue;

    const game = games.get(stake.gameId);
    if (game && !views.has(stake.gameId)) {
      views.set(stake.gameId, { gameState, info: summaryInfo(game, teams) });
    }

    const triggers = engine.evaluateStake(stake, {
      gameId: stake.gameId,
      game: gameState,
      lineup: EMPTY_LINEUP,
    });
    if (triggers.length === 0 || !views.has(stake.gameId)) continue;

    const leverage = Math.max(...triggers.map((trigger) => trigger.leverage));
    const chip: BetChip = {
      stake_id: stake.id,
      label: formatStakeLabel(
        {
          condition: stake.condition,
          subject: {
            type: stake.subject.type,
            teamId: stake.subject.type === 'TEAM' ? stake.subject.teamId : null,
          },
        },
        labelTeams,
      ),
    };
    const existing = byGame.get(stake.gameId);
    if (!existing) {
      byGame.set(stake.gameId, { leverage, bets: [chip] });
      continue;
    }
    existing.bets.push(chip);
    existing.leverage = Math.max(existing.leverage, leverage);
  }

  const scored = new Map<string, { score: number; bets: BetChip[] }>();
  for (const [gameId, contribution] of byGame) {
    contribution.bets.sort((a, b) => a.stake_id.localeCompare(b.stake_id));
    scored.set(gameId, {
      score: betPriorityScore(contribution.leverage),
      bets: contribution.bets,
    });
  }

  return { gameIds, byGame: scored, games: views };
}

export function mergeBetRows<T extends { game_id: string; priority_score: number }>(
  flags: readonly T[],
  week: WeekBets,
  createBetOnly: (
    gameId: string,
    score: number,
    bets: BetChip[],
  ) => { game_id: string; priority_score: number } | null,
): (T & { bets?: BetChip[] })[] {
  const byId = new Map<string, T & { bets?: BetChip[] }>(flags.map((flag) => [flag.game_id, flag]));
  for (const [gameId, contribution] of week.byGame) {
    const existing = byId.get(gameId);
    if (existing) {
      byId.set(gameId, {
        ...existing,
        priority_score: Math.max(existing.priority_score, contribution.score),
        bets: contribution.bets,
      });
      continue;
    }
    const created = createBetOnly(gameId, contribution.score, contribution.bets);
    if (created) {
      byId.set(gameId, { ...(created as T), bets: contribution.bets });
    }
  }
  return [...byId.values()];
}

function summaryInfo(game: GameRow, teams: ReadonlyMap<string, TeamRow>): GameSummaryInfo {
  const home = teams.get(game.home_team_id);
  const away = teams.get(game.away_team_id);
  return {
    homeTeamAbbreviation: home?.abbreviation ?? '',
    awayTeamAbbreviation: away?.abbreviation ?? '',
    homeTeamName: home?.name ?? '',
    awayTeamName: away?.name ?? '',
    homeTeamPrimaryColor: home?.primary_color ?? '',
    homeTeamSecondaryColor: home?.secondary_color ?? '',
    awayTeamPrimaryColor: away?.primary_color ?? '',
    awayTeamSecondaryColor: away?.secondary_color ?? '',
  };
}

function toStake(row: StakeRow): Stake | null {
  if (!STAKE_SOURCES.has(row.source as Stake['source'])) return null;
  const subject = toSubject(row.subject, row.game_id);
  const condition = toCondition(row.condition);
  if (subject === null || condition === null) return null;
  return {
    id: row.id,
    userId: row.user_id,
    season: row.season,
    week: row.week,
    gameId: row.game_id,
    subject,
    condition,
    source: row.source as Stake['source'],
    weight: row.weight,
    createdAt: row.created_at,
  };
}

function toSubject(value: Json, gameId: string): Stake['subject'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = value['type'];
  if (type === 'GAME') return { type: 'GAME', gameId };
  const teamId = value['teamId'];
  if (type === 'TEAM' && typeof teamId === 'string') return { type: 'TEAM', teamId };
  return null;
}

function toCondition(value: Json): Stake['condition'] | null {
  if (!isBetCondition(value)) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = value['type'];
  if (type === 'MONEYLINE') return { type: 'MONEYLINE', side: 'TEAM' };
  if (type === 'SURVIVOR') return { type: 'SURVIVOR' };
  const line = value['line'];
  if (
    (type === 'SPREAD' || type === 'TOTAL_OVER' || type === 'TOTAL_UNDER') &&
    typeof line === 'number'
  ) {
    return { type, line };
  }
  return null;
}
