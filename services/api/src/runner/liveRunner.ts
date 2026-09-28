import { hostname } from 'node:os';
import {
  IncrementalResumptionTracker,
  type LineupCacheReader,
  type PlayEvent,
} from '@pivot/engine';
import { espnClient, translatePlay, type EspnClient } from '@pivot/ingestion';
import {
  ResumptionCeiling,
  ResumptionGatedDispatcher,
  runDispatcherTick,
  type BroadcastCatalog,
  type DeliveryDeps,
  type DispatcherTickDeps,
  type FlagEventPersistence,
  type FlagEventQueue,
  type GameCatalog,
  type GameStateStore,
  type PlayerCatalog,
  type RateLimitStore,
  type RealtimeBus,
  type ResumptionOpenStore,
  type UserDirectory,
} from '@pivot/dispatcher';
import type { PushNotifier } from '@pivot/dispatcher';
import type { LineupCacheProvider } from '../cache/index.js';
import type { SupabaseServiceClient } from '../lib/supabase.js';
import {
  applyDiscovery,
  DISCOVERY_INTERVAL_MS,
  type DiscoveryLoops,
  type GameDirectory,
  type SeededGame,
} from './discovery.js';
import { followGame } from './followGame.js';
import { LEADER_KEY, leaderOwner, type LeaderLockRedis } from './leaderLock.js';
import { startLeaderLoop, type LeaderLoopHandle } from './leaderLoop.js';
import { createPlaySession } from './playSession.js';
import { publishLiveGame } from './publishLiveGame.js';
import { reconcileInProgress } from './reconcile.js';
import { createNoStakeWarner, rebuildStakeCache } from './stakeCache.js';
import { superviseGame } from './superviseGame.js';
import type { SeenPlaySet } from './seenPlays.js';

/** Matches `startDispatcherLoop`. */
const DISPATCHER_TICK_MS = 500;

export interface LiveRunnerDeps {
  lock: LeaderLockRedis;
  seen: SeenPlaySet;
  queue: FlagEventQueue;
  ceilingStore: ResumptionOpenStore;
  gameState: GameStateStore;
  rateLimit: RateLimitStore;
  realtime: RealtimeBus;
  lineupCache: LineupCacheReader;
  games: GameDirectory;
  users: UserDirectory;
  gameCatalog: GameCatalog;
  players: PlayerCatalog;
  broadcasts: BroadcastCatalog;
  persistence: FlagEventPersistence;
  pushNotifier: PushNotifier;
  scoreboard?: EspnClient;
  owner?: string;
  /** Postgres + the Redis lineup cache. Rebuilt when this process becomes leader. */
  stakeCache: {
    supabase: SupabaseServiceClient;
    lineupCache: LineupCacheProvider;
  };
}

export function startLiveRunner(deps: LiveRunnerDeps): LeaderLoopHandle {
  const scoreboard = deps.scoreboard ?? espnClient;
  const owner = deps.owner ?? leaderOwner(process.env['FLY_MACHINE_ID'], hostname(), process.pid);

  return startLeaderLoop({
    redis: deps.lock,
    owner,
    lead: (hold, signal) => runLeader(deps, scoreboard, hold.value, signal),
  });
}

async function runLeader(
  deps: LiveRunnerDeps,
  scoreboard: EspnClient,
  holdValue: string,
  signal: AbortSignal,
): Promise<void> {
  console.log(`[runner] leader ${holdValue}`);
  try {
    await rebuildStakeCache(deps.stakeCache);
  } catch (error) {
    console.error(`[runner] stake cache rebuild failed: ${failureReason(error)}`);
  }
  try {
    await reconcileInProgress({
      scoreboard,
      games: deps.games,
      gameState: deps.gameState,
      catalog: deps.gameCatalog,
      realtime: deps.realtime,
    });
  } catch (error) {
    console.error(`[runner] reconcile failed: ${failureReason(error)}`);
  }
  const warnNoStake = createNoStakeWarner((line) => {
    console.log(line);
  });
  const gamesAbort = new AbortController();
  const onLost = (): void => {
    gamesAbort.abort();
  };
  signal.addEventListener('abort', onLost, { once: true });

  const running = new Map<string, AbortController>();
  const trackers = new Map<string, IncrementalResumptionTracker>();
  const gate = new ResumptionGatedDispatcher({
    queue: deps.queue,
    onGated: () => undefined,
  });
  const ceiling = new ResumptionCeiling({
    store: deps.ceilingStore,
    onFire: (gameId) => {
      trackers.get(gameId)?.applyWallClockCeiling(Date.now());
    },
  });

  const tickDeps: DispatcherTickDeps = {
    queue: deps.queue,
    gameStateStore: deps.gameState,
    userDirectory: deps.users,
    rateLimitStore: deps.rateLimit,
    delivery: deliveryDeps(deps),
  };

  const loops: DiscoveryLoops = {
    isRunning: (gameId) => running.has(gameId),
    stop: (gameId) => {
      running.get(gameId)?.abort();
    },
    start: (game) => {
      if (running.has(game.id) || gamesAbort.signal.aborted) return;
      const controller = new AbortController();
      const abortGame = (): void => {
        controller.abort();
      };
      gamesAbort.signal.addEventListener('abort', abortGame, { once: true });
      running.set(game.id, controller);
      void superviseGame({
        eventId: game.espnEventId,
        signal: controller.signal,
        run: () => followOne(game, controller.signal),
      }).finally(() => {
        gamesAbort.signal.removeEventListener('abort', abortGame);
        if (running.get(game.id) === controller) running.delete(game.id);
      });
    },
  };

  async function followOne(game: SeededGame, gameSignal: AbortSignal): Promise<void> {
    const session = createPlaySession({
      gameId: game.id,
      gate,
      ceiling,
      onPlay: {
        lineupCache: deps.lineupCache,
        gameState: deps.gameState,
        dispatcher: gate,
      },
    });
    trackers.set(game.id, session.tracker);
    try {
      await ceiling.rearm(game.id);
      await followGame({
        eventId: game.espnEventId,
        getSummary: (eventId) => scoreboard.getSummary(eventId),
        seen: deps.seen,
        signal: gameSignal,
        onPlayEvent: async (raw) => {
          const play = withGameWeek(translatePlay(raw, game.id, game.abbrToUuid), game.week);
          await session.handlePlay(play);
          try {
            await publishLiveGame({
              gameId: game.id,
              scheduledStart: game.scheduledStart,
              gameState: deps.gameState,
              catalog: deps.gameCatalog,
              realtime: deps.realtime,
            });
          } catch (error) {
            console.error(`[runner] game_state publish failed ${game.id}: ${failureReason(error)}`);
          }
        },
      });
    } finally {
      session.dispose();
      if (trackers.get(game.id) === session.tracker) trackers.delete(game.id);
    }
  }

  const held = (): Promise<HoldCheck> => stillLeader(deps.lock, holdValue);

  const discovery = pollWhileLeader(
    signal,
    gamesAbort,
    held,
    async () => {
      try {
        const board = await scoreboard.getScoreboard();
        if (!board.ok) {
          console.error(`[runner] scoreboard failed: ${board.reason}`);
          return;
        }
        const found = await applyDiscovery({
          events: board.data.events ?? [],
          games: deps.games,
          gameState: deps.gameState,
          loops,
        });
        await warnNoStake(found.games, (teamId) => deps.gameState.getUsersWithStakeIn(teamId));
      } catch (error) {
        console.error(`[runner] discovery failed: ${failureReason(error)}`);
      }
    },
    DISCOVERY_INTERVAL_MS,
  );

  const ticks = pollWhileLeader(
    signal,
    gamesAbort,
    held,
    async () => {
      try {
        await runDispatcherTick(tickDeps);
      } catch (error) {
        console.error(`[runner] dispatcher tick failed: ${failureReason(error)}`);
      }
    },
    DISPATCHER_TICK_MS,
  );

  try {
    await Promise.all([discovery, ticks]);
  } finally {
    gamesAbort.abort();
    ceiling.stop();
    gate.stop();
    signal.removeEventListener('abort', onLost);
  }
}

function deliveryDeps(deps: LiveRunnerDeps): DeliveryDeps {
  return {
    gameStateStore: deps.gameState,
    gameCatalog: deps.gameCatalog,
    playerCatalog: deps.players,
    broadcastCatalog: deps.broadcasts,
    userDirectory: deps.users,
    persistence: deps.persistence,
    realtimeBus: deps.realtime,
    rateLimitStore: deps.rateLimit,
    pushNotifier: deps.pushNotifier,
  };
}

type HoldCheck = 'held' | 'lost' | 'error';

async function stillLeader(lock: LeaderLockRedis, holdValue: string): Promise<HoldCheck> {
  try {
    return (await lock.get(LEADER_KEY)) === holdValue ? 'held' : 'lost';
  } catch (error) {
    console.error(`[runner] lock check failed: ${failureReason(error)}`);
    return 'error';
  }
}

async function pollWhileLeader(
  signal: AbortSignal,
  gamesAbort: AbortController,
  held: () => Promise<HoldCheck>,
  tick: () => Promise<void>,
  intervalMs: number,
): Promise<void> {
  while (!signal.aborted && !gamesAbort.signal.aborted) {
    const check = await held();
    if (signal.aborted || gamesAbort.signal.aborted) return;
    if (check === 'lost') {
      gamesAbort.abort();
      return;
    }
    if (check === 'held') await tick();
    await sleep(intervalMs, gamesAbort.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

function withGameWeek(play: PlayEvent, week: number): PlayEvent {
  return { ...play, week };
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
