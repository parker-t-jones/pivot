import type { GameState } from '@pivot/shared';

/** Leader scoreboard poll. */
export const DISCOVERY_INTERVAL_MS = 30_000;

const NOT_LIVE_NAME = ['postponed', 'canceled', 'delayed'] as const;

export interface ScoreboardStatusType {
  state?: string | undefined;
  name?: string | undefined;
  completed?: boolean | undefined;
}

export interface DiscoveryEvent {
  id: string;
  status?: { type?: ScoreboardStatusType | undefined } | undefined;
}

export interface SeededGame {
  id: string;
  espnEventId: string;
  homeTeamId: string;
  awayTeamId: string;
  week: number;
  status: string;
  abbrToUuid: Map<string, string>;
}

export interface GameDirectory {
  findByEspnId(espnEventId: string): Promise<SeededGame | null>;
  setStatus(gameId: string, status: 'in_progress' | 'final'): Promise<void>;
}

export interface DiscoveryGameState {
  getGameState(gameId: string): Promise<GameState | null>;
  setGameState(gameId: string, state: GameState): Promise<void>;
}

export interface DiscoveryLoops {
  isRunning(gameId: string): boolean;
  start(game: SeededGame): void;
  stop(gameId: string): void;
}

export type DiscoveryDisposition =
  | { kind: 'live' }
  | { kind: 'final' }
  | { kind: 'scheduled' }
  | { kind: 'not_live'; state: string | undefined; name: string | undefined }
  | { kind: 'unknown'; state: string | undefined; name: string | undefined };

/** Postponed, canceled, and delayed win over `state === 'in'`. Anything else unknown is not live. */
export function classifyScoreboardStatus(
  status: ScoreboardStatusType | undefined,
): DiscoveryDisposition {
  const name = status?.name;
  const state = status?.state;
  const lowered = name?.toLowerCase() ?? '';
  if (NOT_LIVE_NAME.some((word) => lowered.includes(word))) {
    return { kind: 'not_live', state, name };
  }
  if (state === 'pre') return { kind: 'scheduled' };
  if (status?.completed === true || state === 'post' || state === 'completed') {
    return { kind: 'final' };
  }
  if (state === 'in') return { kind: 'live' };
  return { kind: 'unknown', state, name };
}

/**
 * Placeholder hash so `in_progress` is not written before Redis has `game_state`.
 * The first play replaces scores, quarter, and clock.
 */
export function shellGameState(game: SeededGame, now: number): GameState {
  return {
    gameId: game.id,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    possessionTeamId: null,
    unitOnField: 'none',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    timeRemainingSec: 0,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: now,
  };
}

export async function applyDiscovery(deps: {
  events: readonly DiscoveryEvent[];
  games: GameDirectory;
  gameState: DiscoveryGameState;
  loops: DiscoveryLoops;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<{ live: number }> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  let live = 0;

  for (const event of deps.events) {
    const disposition = classifyScoreboardStatus(event.status?.type);
    if (disposition.kind === 'not_live') {
      log(
        `[runner] not live ${event.id}: name=${disposition.name ?? ''} state=${disposition.state ?? ''}`,
      );
      continue;
    }
    if (disposition.kind === 'unknown') {
      log(
        `[runner] unknown state ${event.id}: state=${disposition.state ?? ''} name=${disposition.name ?? ''}`,
      );
      continue;
    }
    if (disposition.kind === 'scheduled') continue;

    const game = await deps.games.findByEspnId(event.id);
    if (game === null) {
      log(`[runner] no seeded game for ESPN id ${event.id}`);
      continue;
    }

    if (disposition.kind === 'final') {
      deps.loops.stop(game.id);
      const existing = await deps.gameState.getGameState(game.id);
      if (existing !== null) {
        await deps.gameState.setGameState(game.id, {
          ...existing,
          status: 'final',
          updatedAt: now(),
        });
      }
      await deps.games.setStatus(game.id, 'final');
      continue;
    }

    live += 1;
    const existing = await deps.gameState.getGameState(game.id);
    if (existing === null) {
      await deps.gameState.setGameState(game.id, shellGameState(game, now()));
    } else if (existing.status !== 'in_progress') {
      await deps.gameState.setGameState(game.id, {
        ...existing,
        status: 'in_progress',
        updatedAt: now(),
      });
    }
    if (game.status !== 'in_progress') {
      await deps.games.setStatus(game.id, 'in_progress');
    }
    if (!deps.loops.isRunning(game.id)) deps.loops.start(game);
  }

  log(`[runner] discovery live=${live}`);
  return { live };
}
