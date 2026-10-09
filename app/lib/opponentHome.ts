import type { GameSummary } from './flagEventPayload';
import type { CurrentFlag, OpponentFlagWire } from './gameDisplay';
import type { LiveGame } from './schedule';

export const OPPONENT_REFETCH_DEBOUNCE_MS = 1000;

/** Chip / Also Flagged label. Names only — no score and no yardage. */
export function opponentChipLabel(playerNames: readonly string[]): string {
  return `OPPONENT · ${playerNames.join(', ')}`;
}

/** Missing keys are the preference-off body: no opponent rows, same ranking as today. */
export function readOpponentFields(response: {
  opponent_flags?: OpponentFlagWire[];
  opponent_game_ids?: string[];
}): { opponentFlags: OpponentFlagWire[]; opponentGameIds: string[] } {
  return {
    opponentFlags: response.opponent_flags ?? [],
    opponentGameIds: response.opponent_game_ids ?? [],
  };
}

export function liveGameSummary(game: LiveGame): GameSummary {
  return {
    home_team: game.home_team,
    away_team: game.away_team,
    home_team_name: game.home_team_name,
    away_team_name: game.away_team_name,
    home_team_primary_color: game.home_team_primary_color,
    home_team_secondary_color: game.home_team_secondary_color,
    away_team_primary_color: game.away_team_primary_color,
    away_team_secondary_color: game.away_team_secondary_color,
    score: game.score,
    quarter: game.quarter,
    time_remaining_sec: game.time_remaining_sec,
    possession_team: game.possession_team,
    yards_to_endzone: game.yards_to_endzone,
    down: game.down,
    distance: game.distance,
    in_red_zone: game.in_red_zone,
  };
}

/**
 * Own flags stay in server order. Opponent rows are appended after every own flag.
 * The first row is Now Active, so an opponent flag leads only when there is no own flag.
 */
export function rankHomeFlags(
  ownFlags: readonly CurrentFlag[],
  opponentFlags: readonly OpponentFlagWire[],
  gamesById: ReadonlyMap<string, GameSummary>,
): CurrentFlag[] {
  const opponentCards: CurrentFlag[] = [];
  for (const row of opponentFlags) {
    const game = gamesById.get(row.game_id);
    if (!game) continue;
    const names = opponentPlayerNames(row);
    opponentCards.push({
      game_id: row.game_id,
      priority_score: row.priority_score,
      reasons: [...row.reasons],
      flagged_players: (row.players ?? []).map((player) => ({
        player_id: player.player_id,
        first_name: player.first_name,
        last_name: player.last_name,
        position: '',
      })),
      game,
      recommended_action: 'notify_only',
      opponent_label: opponentChipLabel(names),
    });
  }
  return [...ownFlags, ...opponentCards];
}

export function placeHomeFlags(
  ownFlags: readonly CurrentFlag[],
  opponentFlags: readonly OpponentFlagWire[],
  liveGames: readonly LiveGame[],
): { flag: CurrentFlag | null; otherFlags: CurrentFlag[] } {
  const gamesById = new Map(liveGames.map((game) => [game.game_id, liveGameSummary(game)]));
  const ranked = rankHomeFlags(ownFlags, opponentFlags, gamesById);
  const [flag, ...otherFlags] = ranked;
  return { flag: flag ?? null, otherFlags };
}

export interface OpponentRefreshState {
  opponentGameIds: readonly string[];
  seenRedZone: Readonly<Record<string, boolean>>;
  inFlight: boolean;
  pending: boolean;
  dueAtMs: number | null;
}

export function emptyOpponentRefresh(gameIds: readonly string[] = []): OpponentRefreshState {
  return {
    opponentGameIds: gameIds,
    seenRedZone: {},
    inFlight: false,
    pending: false,
    dueAtMs: null,
  };
}

/** Remember the red-zone bit Home already loaded, so the first socket echo is not a flip. */
export function seedOpponentRedZone(
  gameIds: readonly string[],
  live: readonly { game_id: string; in_red_zone: boolean }[],
): OpponentRefreshState {
  const byId = new Map(live.map((game) => [game.game_id, game.in_red_zone]));
  const seenRedZone: Record<string, boolean> = {};
  for (const gameId of gameIds) {
    const value = byId.get(gameId);
    if (value !== undefined) seenRedZone[gameId] = value;
  }
  return {
    opponentGameIds: gameIds,
    seenRedZone,
    inFlight: false,
    pending: false,
    dueAtMs: null,
  };
}

export function adoptOpponentGames(
  state: OpponentRefreshState,
  gameIds: readonly string[],
  live: readonly { game_id: string; in_red_zone: boolean }[],
): OpponentRefreshState {
  const byId = new Map(live.map((game) => [game.game_id, game.in_red_zone]));
  const seenRedZone: Record<string, boolean> = {};
  for (const gameId of gameIds) {
    if (Object.prototype.hasOwnProperty.call(state.seenRedZone, gameId)) {
      const seen = state.seenRedZone[gameId];
      if (seen !== undefined) seenRedZone[gameId] = seen;
      continue;
    }
    const value = byId.get(gameId);
    if (value !== undefined) seenRedZone[gameId] = value;
  }
  return { ...state, opponentGameIds: gameIds, seenRedZone };
}

/**
 * Schedule a `/flags/current` refetch only for a listed game whose `in_red_zone` flipped.
 * The first observation is recorded and does not refetch. One request at a time; further flips
 * wait until it settles, then debounce again.
 */
export function noteOpponentGameState(
  state: OpponentRefreshState,
  event: { gameId: string; inRedZone: boolean; nowMs: number },
  debounceMs = OPPONENT_REFETCH_DEBOUNCE_MS,
): OpponentRefreshState {
  if (!state.opponentGameIds.includes(event.gameId)) return state;
  const previous = state.seenRedZone[event.gameId];
  if (previous === event.inRedZone) return state;
  const seenRedZone = { ...state.seenRedZone, [event.gameId]: event.inRedZone };
  if (previous === undefined) return { ...state, seenRedZone };
  if (state.inFlight) return { ...state, seenRedZone, pending: true };
  return { ...state, seenRedZone, dueAtMs: event.nowMs + debounceMs };
}

export function noteOpponentRefetchStarted(state: OpponentRefreshState): OpponentRefreshState {
  return { ...state, inFlight: true, pending: false, dueAtMs: null };
}

export function noteOpponentRefetchSettled(
  state: OpponentRefreshState,
  nowMs: number,
  debounceMs = OPPONENT_REFETCH_DEBOUNCE_MS,
): OpponentRefreshState {
  if (state.pending) {
    return { ...state, inFlight: false, pending: false, dueAtMs: nowMs + debounceMs };
  }
  return { ...state, inFlight: false, dueAtMs: null };
}

function opponentPlayerNames(row: OpponentFlagWire): string[] {
  const named = (row.players ?? [])
    .map((player) => `${player.first_name} ${player.last_name}`.trim())
    .filter((name) => name.length > 0);
  return named.length > 0 ? named : row.player_ids;
}
