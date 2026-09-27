import {
  onPlayEvent,
  type LineupCacheReader,
  type OnPlayEventDeps,
  type PlayEvent,
} from '@pivot/engine';
import type { UserLineupCache } from '@pivot/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
import {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
} from './catalogs.js';
import type { DeliveryDeps } from './delivery.js';
import { runDispatcherTick, type DispatcherTickDeps } from './dispatcher.js';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { NoOpPushNotifier } from './pushNotifier.js';
import { InMemoryGameStateStore } from './providers/inMemoryGameStateStore.js';
import { InMemoryRateLimitStore } from './rateLimiter.js';
import { realtimeUserChannel, InMemoryRealtimeBus } from './realtimeBus.js';
import { QueueingEventDispatcher } from './scheduleFlagEvent.js';

/*
 * End-to-end proof of the full Sprint 5 pipeline, wired exactly as production will assemble it:
 * Sprint 4's `onPlayEvent` (untouched) fed a `QueueingEventDispatcher` (Phase 2) in place of the
 * `CapturingEventDispatcher` it used pre-Sprint-5, so the engine never knows the difference — this
 * IS the seam the sprint plan called out ("swapping the injected dispatcher instance is the entire
 * integration point"). From there: `flag_event_queue` -> `runDispatcherTick` (Phase 2) ->
 * `isStillRelevant` (freshness only; Decision 8) -> `shouldRateLimit` (Phase 2) ->
 * `deliverFlagEvent` (Phase 2) -> persistence + realtime bus.
 *
 * Only in-memory providers (decision #2) — no Redis, no Postgres. `vi.useFakeTimers()` controls both
 * the injectable `Clock` (engine/dispatcher default to `Date.now()`) AND `GameStateStore`'s
 * active-user TTL (hardcoded `Date.now()`, not clock-injectable) on the SAME mocked clock.
 */

const GAME_ID = 'g1';
const HOME = 'KC';
const AWAY = 'LV';
const WEEK = 5;
const USER_ID = 'u1';
const PLAYER_ID = 'p1';
/** Gap between plays in the rate-limit case. Fire time is the clock, so this is not broadcast lag. */
const PLAY_GAP_MS = 1_000;

class StubLineupCache implements LineupCacheReader {
  constructor(private readonly cache: UserLineupCache) {}
  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    return userId === this.cache.userId && week === this.cache.week ? this.cache : null;
  }
}

const freeUser: DispatchUser = {
  id: USER_ID,
  subscriptionTier: 'free',
  preferences: {
    notificationMode: 'all',
    quietHours: { enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' },
    autoSwitch: false,
    watchedLeagueIds: [],
  },
  expoPushToken: null, // push isn't this pipeline test's concern — see delivery.test.ts's "push" block
};

interface Pipeline {
  gameStateStore: InMemoryGameStateStore;
  queue: InMemoryFlagEventQueue;
  userDirectory: InMemoryUserDirectory;
  rateLimitStore: InMemoryRateLimitStore;
  realtimeBus: InMemoryRealtimeBus;
  persistence: InMemoryFlagEventPersistence;
  onPlayEventDeps: OnPlayEventDeps;
  tickDeps: DispatcherTickDeps;
}

/** Wires one full pipeline: a user with an offensive stake in `HOME`, a lineup cache, a broadcast
 *  catalog resolving to `cbs` (8s lag), and every Phase 1-3 in-memory provider. Every scenario below
 *  builds its own fresh instance so state never bleeds between tests. */
function buildPipeline(): Pipeline {
  const lineup: UserLineupCache = {
    userId: USER_ID,
    week: WEEK,
    teamPositions: new Map([[HOME, new Set<'offense' | 'defense'>(['offense'])]]),
    playerToTeam: new Map([[PLAYER_ID, HOME]]),
    starPlayerIds: new Set(),
  };

  const gameStateStore = new InMemoryGameStateStore();
  gameStateStore.addStake(HOME, USER_ID);

  const broadcastCatalog = new InMemoryBroadcastCatalog();
  broadcastCatalog.setGameBroadcasts(GAME_ID, [
    { service: 'cbs', deepLinkUrl: 'https://cbs.example/watch', requiresSubscription: false },
  ]);
  broadcastCatalog.setUserSubscribedServices(USER_ID, ['cbs']);

  const queue = new InMemoryFlagEventQueue();
  const engineDispatcher = new QueueingEventDispatcher({ queue });

  const userDirectory = new InMemoryUserDirectory();
  userDirectory.setUser(freeUser);

  const rateLimitStore = new InMemoryRateLimitStore();
  const realtimeBus = new InMemoryRealtimeBus();
  const persistence = new InMemoryFlagEventPersistence();

  const delivery: DeliveryDeps = {
    gameStateStore,
    gameCatalog: new InMemoryGameCatalog(),
    playerCatalog: new InMemoryPlayerCatalog(),
    broadcastCatalog,
    userDirectory,
    persistence,
    realtimeBus,
    rateLimitStore,
    pushNotifier: new NoOpPushNotifier(),
  };

  const onPlayEventDeps: OnPlayEventDeps = {
    lineupCache: new StubLineupCache(lineup),
    gameState: gameStateStore,
    dispatcher: engineDispatcher,
  };

  const tickDeps: DispatcherTickDeps = {
    queue,
    gameStateStore,
    userDirectory,
    rateLimitStore,
    delivery,
  };

  return {
    gameStateStore,
    queue,
    userDirectory,
    rateLimitStore,
    realtimeBus,
    persistence,
    onPlayEventDeps,
    tickDeps,
  };
}

function makePlay(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return {
    playId: 'play-1',
    gameId: GAME_ID,
    week: WEEK,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    possessionTeamId: HOME,
    playType: 'run',
    scoreHome: 0,
    scoreAway: 0,
    quarter: 1,
    secondsRemainingInQuarter: 800,
    yardsToOpponentEndzone: 50,
    down: 1,
    distance: 10,
    isFinalPlay: false,
    ...overrides,
  };
}

/** Flips possession to AWAY (a genuine change, not a stoppage) — reliably produces a `flag_removed`
 *  diff against whatever flag_added state preceded it, without needing priority-delta math. Not a
 *  `timeout`: `applyPlayToState`'s carry-forward fix (Live Sunday test, Finding 1/1a — a `timeout` or
 *  other `SKIP_AND_WAIT`/same-team `no_play` no longer zeroes `unitOnField` when possession hasn't
 *  actually changed) means a real timeout play here would no longer toggle the flag off at all, which
 *  is the whole point of that fix — so this test needs an actual possession change instead. */
function makeAwayPossessionPlay(overrides: Partial<PlayEvent> = {}): PlayEvent {
  return makePlay({
    playId: 'play-away',
    possessionTeamId: AWAY,
    ...overrides,
  });
}

const T0 = 1_700_000_000_000;

describe('dispatcher end-to-end integration (engine -> flag_event_queue -> dispatcher tick)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy path: play -> engine emits & queues -> dispatcher tick re-validates and delivers', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    await onPlayEvent(p.onPlayEventDeps, makePlay());

    // Fire time is the clock at dispatch, not clock plus a broadcast lag.
    expect(p.queue.size()).toBe(1);
    expect(await p.queue.due(T0 - 1, 10)).toHaveLength(0);
    expect(await p.queue.due(T0, 10)).toHaveLength(1);

    const result = await runDispatcherTick(p.tickDeps);

    expect(result).toEqual({
      processed: 1,
      delivered: 1,
      droppedStale: 0,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(p.queue.size()).toBe(0);
    expect(p.persistence.records).toHaveLength(1);
    expect(p.persistence.records[0]).toMatchObject({
      userId: USER_ID,
      gameId: GAME_ID,
      eventType: 'flag_added',
      firedAt: T0,
      deliveredAt: T0,
    });
    expect(p.realtimeBus.published).toHaveLength(1);
    expect(p.realtimeBus.published[0]?.channel).toBe(realtimeUserChannel(USER_ID));
  });

  it('delivers a fresh event when the user has no active socket', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    await onPlayEvent(p.onPlayEventDeps, makePlay());
    expect(p.queue.size()).toBe(1);

    await p.gameStateStore.removeActiveUser(USER_ID);

    const result = await runDispatcherTick(p.tickDeps);

    expect(result).toEqual({
      processed: 1,
      delivered: 1,
      droppedStale: 0,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(p.persistence.records).toHaveLength(1);
    expect(p.realtimeBus.published).toHaveLength(1);
  });

  it('stale event drop: a superseding play invalidates the queued event before it fires', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    // t1: KC run, midfield -> flag_added (priority 2), due at T0.
    await onPlayEvent(p.onPlayEventDeps, makePlay());
    expect(p.queue.size()).toBe(1);

    // t2 (2s later): KC is now in the red zone -> priority jumps 2 -> 5 (delta 3, over the
    // priority_increased threshold), overwriting user_flag_state with a NEWER computedAt.
    // Both events are due: fire time is the clock at each dispatch.
    vi.advanceTimersByTime(2_000);
    await onPlayEvent(
      p.onPlayEventDeps,
      makePlay({ playId: 'play-2', yardsToOpponentEndzone: 15 }),
    );
    expect(p.queue.size()).toBe(2);

    const result = await runDispatcherTick(p.tickDeps);

    expect(result).toEqual({
      processed: 2,
      delivered: 1,
      droppedStale: 1,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(p.persistence.records).toHaveLength(1);
    expect(p.persistence.records[0]?.priorityScore).toBe(5);
    expect(p.realtimeBus.published).toHaveLength(1);
    expect(p.queue.size()).toBe(0);
  });

  it('rate limit: a 4th flag_added within 60s is dropped; other types do not count', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    // flag_added, flag_removed, flag_added, ... The clears are delivered and do not fill the window.
    // The 4th flag_added is the one the limiter drops.
    for (let i = 0; i < 7; i += 1) {
      const play =
        i % 2 === 0
          ? makePlay({ playId: `play-${i}` })
          : makeAwayPossessionPlay({ playId: `play-${i}` });
      await onPlayEvent(p.onPlayEventDeps, play);
      vi.advanceTimersByTime(PLAY_GAP_MS);

      const result = await runDispatcherTick(p.tickDeps);
      const flagAddedIndex = Math.floor(i / 2);
      if (i % 2 === 1 || flagAddedIndex < 3) {
        expect(result.delivered).toBe(1);
      } else {
        expect(result.droppedRateLimited).toBe(1);
      }
    }

    expect(p.persistence.records).toHaveLength(6);
    expect(p.realtimeBus.published).toHaveLength(6);
    expect(p.queue.size()).toBe(0);
  });
});
