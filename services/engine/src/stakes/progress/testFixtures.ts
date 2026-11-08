// Test-only builders for the picks tests. Not exported from the package.
import type { GamePlayerStats, GameState, ParsedPlayerLine, StakeCondition } from '@pivot/shared';
import type { EvaluatorContext, PropPlayer, Stake, StakeSubject } from '../types.js';

export const HOME = 'GB';
export const AWAY = 'ATL';
export const GAME_ID = 'game-1';
export const PLAYER_ID = 'player-bijan';
export const ESPN_ID = '4430807';

export function game(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: GAME_ID,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: AWAY,
    unitOnField: 'offense',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 2,
    timeRemainingSec: 600,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1,
    ...overrides,
  };
}

export function player(overrides: Partial<PropPlayer> = {}): PropPlayer {
  return {
    playerId: PLAYER_ID,
    teamId: AWAY,
    unit: 'offense',
    espnId: ESPN_ID,
    firstName: 'Bijan',
    lastName: 'Robinson',
    ...overrides,
  };
}

export function line(
  stats: ParsedPlayerLine['stats'],
  overrides: Partial<ParsedPlayerLine> = {},
): ParsedPlayerLine {
  return { teamId: AWAY, displayName: 'Bijan Robinson', stats, ...overrides };
}

export function stats(overrides: Partial<GamePlayerStats> = {}): GamePlayerStats {
  return {
    gameId: GAME_ID,
    fetchedAt: 1,
    final: false,
    players: {},
    linescores: { home: [], away: [] },
    scoringPlays: [],
    ...overrides,
  };
}

export function stake(
  condition: StakeCondition,
  subject: StakeSubject = { type: 'PLAYER', playerId: PLAYER_ID, teamId: AWAY },
  overrides: Partial<Stake> = {},
): Stake {
  return {
    id: 'stake-1',
    userId: 'user-1',
    season: 2026,
    week: 3,
    gameId: GAME_ID,
    subject,
    condition,
    source: 'MANUAL',
    weight: 1,
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

export function ctx(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    gameId: GAME_ID,
    game: game(),
    lineup: {
      userId: '',
      week: 0,
      teamPositions: new Map(),
      playerToTeam: new Map(),
      starPlayerIds: new Set(),
    },
    player: player(),
    playerStats: stats(),
    ...overrides,
  };
}

export const TEAM_ATL: StakeSubject = { type: 'TEAM', teamId: AWAY };
export const TEAM_GB: StakeSubject = { type: 'TEAM', teamId: HOME };
export const WHOLE_GAME: StakeSubject = { type: 'GAME', gameId: GAME_ID };
