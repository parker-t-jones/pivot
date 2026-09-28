import type { GameState } from '@pivot/shared';

/** Leader scoreboard poll. */
export const DISCOVERY_INTERVAL_MS = 30_000;

const NOT_LIVE_NAME = ['postponed', 'canceled', 'cancelled', 'delayed'] as const;

export interface ScoreboardStatusType {
  state?: string | undefined;
  name?: string | undefined;
  completed?: boolean | undefined;
}

export interface DiscoveryCompetitor {
  homeAway?: 'home' | 'away' | undefined;
  score?: string | number | undefined;
}

export interface DiscoveryClock {
  period?: number | undefined;
  displayClock?: string | undefined;
}

export interface DiscoveryEvent {
  id: string;
  status?: ({ type?: ScoreboardStatusType | undefined } & DiscoveryClock) | undefined;
  competitions?:
    | {
        competitors?: DiscoveryCompetitor[] | undefined;
        status?: DiscoveryClock | undefined;
      }[]
    | undefined;
}

export interface SeededGame {
  id: string;
  espnEventId: string;
  homeTeamId: string;
  awayTeamId: string;
  week: number;
  status: string;
  scheduledStart: string;
  abbrToUuid: Map<string, string>;
}

/**
 * A `games` row leader reconcile revisits: still `in_progress`, or still `scheduled` well past
 * kickoff. `espnEventId` is null when it wasn't seeded from ESPN.
 */
export interface StaleGame {
  id: string;
  espnEventId: string | null;
  scheduledStart: string;
  seasonYear: number;
  seasonType: 'pre' | 'regular' | 'post';
  week: number;
}

export interface GameDirectory {
  findByEspnId(espnEventId: string): Promise<SeededGame | null>;
  setStatus(gameId: string, status: 'in_progress' | 'final'): Promise<void>;
  listInProgress(): Promise<StaleGame[]>;
  /** `scheduled` rows whose `scheduled_start` is before `kickoffBefore` (ISO timestamp). */
  listStaleScheduled(kickoffBefore: string): Promise<StaleGame[]>;
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

/** Postponed, canceled, cancelled, and delayed win over `state === 'in'`. Anything else unknown is not live. */
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

/** ESPN `M:SS` → seconds. Missing or unparseable → 0. */
export function displayClockToSeconds(displayClock: string | undefined): number {
  const match = /^(\d+):(\d{1,2})$/.exec((displayClock ?? '').trim());
  if (match === null) return 0;
  return Number(match[1] ?? '0') * 60 + Number(match[2] ?? '0');
}

function competitorScore(
  competitors: readonly DiscoveryCompetitor[] | undefined,
  homeAway: 'home' | 'away',
): number {
  const raw = competitors?.find((competitor) => competitor.homeAway === homeAway)?.score;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return 0;
}

/**
 * First Redis hash for a game ESPN has marked live. Score, quarter, and clock come from the
 * scoreboard event. Possession and down wait for the first play.
 */
export function seedGameState(game: SeededGame, event: DiscoveryEvent, now: number): GameState {
  const competition = event.competitions?.[0];
  const period = event.status?.period ?? competition?.status?.period;
  const displayClock = event.status?.displayClock ?? competition?.status?.displayClock;
  return {
    gameId: game.id,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    possessionTeamId: null,
    unitOnField: 'none',
    scoreHome: competitorScore(competition?.competitors, 'home'),
    scoreAway: competitorScore(competition?.competitors, 'away'),
    quarter: period !== undefined && period > 0 ? period : 1,
    timeRemainingSec: displayClockToSeconds(displayClock),
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
  games: Pick<GameDirectory, 'findByEspnId' | 'setStatus'>;
  gameState: DiscoveryGameState;
  loops: DiscoveryLoops;
  now?: () => number;
  log?: (line: string) => void;
}): Promise<{ live: number; games: SeededGame[] }> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  let live = 0;
  const games: SeededGame[] = [];

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
    games.push(game);
    const existing = await deps.gameState.getGameState(game.id);
    if (existing === null) {
      await deps.gameState.setGameState(game.id, seedGameState(game, event, now()));
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
  return { live, games };
}
