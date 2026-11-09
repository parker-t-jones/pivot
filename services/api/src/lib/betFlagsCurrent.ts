import * as engine from '@pivot/engine';
import type { PropPlayer, Stake } from '@pivot/engine';
import { formatPickLabel, shortPlayerName, type StakeTeam } from '@pivot/shared/stakeLabel';
import type { GamePlayerStats, GameState, UserLineupCache } from '@pivot/shared';
import type { GameSummaryInfo } from '@pivot/dispatcher';
import { isBetCondition } from './betIndex.js';
import { STAKE_ROW_COLUMNS, toStake, type StakeRowLike } from './pickRows.js';
import { loadPropPlayers } from './propPlayers.js';
import type { SupabaseServiceClient } from './supabase.js';

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

/** A parlay leg that is not the slip's last open leg ranks at this share (docs §4). */
export const SLIP_OTHER_LEG_FACTOR = 0.8;

/**
 * Ranking factor for a parlay leg: 0 once the slip has lost, 1 when this is its only open leg,
 * 0.8 otherwise. In-app ranking only; the nudge itself never depends on it.
 */
export function slipLegFactor(
  legs: readonly { stakeId: string; open: boolean; lost: boolean }[],
  stakeId: string,
): number {
  if (legs.some((leg) => leg.lost)) return 0;
  const open = legs.filter((leg) => leg.open);
  return open.length === 1 && open[0]?.stakeId === stakeId ? 1 : SLIP_OTHER_LEG_FACTOR;
}

export async function loadWeekBets(input: {
  supabase: SupabaseServiceClient;
  getGameState: (gameId: string) => Promise<GameState | null>;
  userId: string;
  week: number;
  gameIds: readonly string[];
  /** Latest parsed summary per game (Redis). Omitted, player and team props show no activity. */
  getPlayerStats?: (gameId: string) => Promise<GamePlayerStats | null>;
}): Promise<WeekBets | null> {
  const wanted = new Set(input.gameIds);
  if (wanted.size === 0) return null;

  const { data, error } = await input.supabase
    .from('stakes')
    .select(STAKE_ROW_COLUMNS)
    .eq('user_id', input.userId)
    .eq('week', input.week)
    .in('game_id', [...wanted]);
  if (error) throw new Error(error.message);

  const stakes = ((data ?? []) as StakeRowLike[])
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
  const statsByGame = new Map<string, GamePlayerStats | null>();
  const players = await loadPropPlayers(
    input.supabase,
    stakes.flatMap((stake) => (stake.subject.type === 'PLAYER' ? [stake.subject.playerId] : [])),
  );

  const stateFor = async (gameId: string): Promise<GameState | null> => {
    let gameState = stateByGame.get(gameId);
    if (gameState === undefined) {
      gameState = await input.getGameState(gameId);
      stateByGame.set(gameId, gameState);
    }
    return gameState;
  };
  const statsFor = async (gameId: string): Promise<GamePlayerStats | null> => {
    if (!input.getPlayerStats) return null;
    let stats = statsByGame.get(gameId);
    if (stats === undefined) {
      stats = await input.getPlayerStats(gameId);
      statsByGame.set(gameId, stats);
    }
    return stats;
  };
  const contextFor = async (stake: Stake, gameState: GameState) => {
    const stats = await statsFor(stake.gameId);
    const player =
      stake.subject.type === 'PLAYER' ? players.get(stake.subject.playerId) : undefined;
    return {
      gameId: stake.gameId,
      game: gameState,
      lineup: EMPTY_LINEUP,
      ...(stats ? { playerStats: stats } : {}),
      ...(player ? { player } : {}),
    };
  };

  // Every leg of each slip, so a leg's ranking knows whether the slip is alive.
  const slipLegs = new Map<string, { stakeId: string; open: boolean; lost: boolean }[]>();
  for (const stake of stakes) {
    if (stake.slipId === undefined) continue;
    const gameState = await stateFor(stake.gameId);
    const progress = gameState
      ? engine.pickProgress(stake, await contextFor(stake, gameState))
      : { status: 'pending' as const };
    const legs = slipLegs.get(stake.slipId) ?? [];
    legs.push({
      stakeId: stake.id,
      open: !engine.isDecided(progress),
      lost: progress.status === 'lost' || progress.status === 'missed',
    });
    slipLegs.set(stake.slipId, legs);
  }

  for (const stake of stakes) {
    const gameState = await stateFor(stake.gameId);
    if (!gameState || gameState.status === 'final') continue;

    const game = games.get(stake.gameId);
    if (game && !views.has(stake.gameId)) {
      views.set(stake.gameId, { gameState, info: summaryInfo(game, teams) });
    }

    const triggers = engine.evaluateStake(stake, await contextFor(stake, gameState));
    if (triggers.length === 0 || !views.has(stake.gameId)) continue;

    const factor =
      stake.slipId === undefined ? 1 : slipLegFactor(slipLegs.get(stake.slipId) ?? [], stake.id);
    // A game's score is the max over its picks, so a slip counts once per game, never per leg.
    const leverage = factor * Math.max(...triggers.map((trigger) => trigger.leverage));
    const player: PropPlayer | undefined =
      stake.subject.type === 'PLAYER' ? players.get(stake.subject.playerId) : undefined;
    const chip: BetChip = {
      stake_id: stake.id,
      label: formatPickLabel(
        {
          condition: stake.condition,
          subject: {
            type: stake.subject.type,
            teamId: stake.subject.type === 'TEAM' ? stake.subject.teamId : null,
          },
          playerName: player ? shortPlayerName(player.firstName, player.lastName) : null,
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
