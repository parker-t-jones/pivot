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
 * `isStillRelevant` (Sprint 4 closeout #1, both gates) -> `shouldRateLimit` (Phase 2) ->
 * `deliverFlagEvent` (Phase 2) -> persistence + realtime bus.
 *
 * Only in-memory providers (decision #2) — no Redis, no Postgres. `vi.useFakeTimers()` controls both
 * the injectable `Clock` (engine/dispatcher default to `Date.now()`) AND `GameStateStore`'s
 * active-user TTL (hardcoded `Date.now()`, not clock-injectable) on the SAME mocked clock, which is
 * the only way to advance "broadcast lag" time without a real 8-60s wait per scenario.
 */

const GAME_ID = 'g1';
const HOME = 'KC';
const AWAY = 'LV';
const WEEK = 5;
const USER_ID = 'u1';
const PLAYER_ID = 'p1';
/** `BROADCAST_LAG_SECONDS.cbs` (broadcastLag.ts) — seeded below as the user's only matching service,
 *  so `scheduledFireAt` is a precise, assertable `computedAt + 8000`, not the 60s unresolved fallback. */
const CBS_LAG_MS = 8_000;

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
  const engineDispatcher = new QueueingEventDispatcher({ queue, broadcastCatalog });

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

    // Queued with the DISPATCHER's real scheduledFireAt (computedAt + cbs's 8s lag) — the engine's
    // discarded placeholder would have been `computedAt` itself (Sprint 4 closeout #3).
    expect(p.queue.size()).toBe(1);
    expect(await p.queue.due(T0 + CBS_LAG_MS - 1, 10)).toHaveLength(0); // not due one ms early
    expect(await p.queue.due(T0 + CBS_LAG_MS, 10)).toHaveLength(1);

    vi.advanceTimersByTime(CBS_LAG_MS);

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
      firedAt: T0 + CBS_LAG_MS,
      deliveredAt: T0 + CBS_LAG_MS,
    });
    expect(p.realtimeBus.published).toHaveLength(1);
    expect(p.realtimeBus.published[0]?.channel).toBe(realtimeUserChannel(USER_ID));
  });

  it('inactive user drop (Sprint 4 closeout #1): user goes inactive after queuing, before fire time', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    await onPlayEvent(p.onPlayEventDeps, makePlay());
    expect(p.queue.size()).toBe(1);

    // Goes inactive during the deferral window — the flag state itself never changes.
    await p.gameStateStore.removeActiveUser(USER_ID);

    vi.advanceTimersByTime(CBS_LAG_MS);
    const result = await runDispatcherTick(p.tickDeps);

    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      droppedStale: 1,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(p.queue.size()).toBe(0);
    expect(p.persistence.records).toHaveLength(0);
    expect(p.realtimeBus.published).toHaveLength(0);
  });

  it('stale event drop: a superseding play invalidates the queued event before it fires', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    // t1: KC run, midfield -> flag_added (priority 2), queued for T0 + 8s.
    await onPlayEvent(p.onPlayEventDeps, makePlay());
    expect(p.queue.size()).toBe(1);

    // t2 (2s later): KC is now in the red zone -> priority jumps 2 -> 5 (delta 3, over the
    // priority_increased threshold), overwriting user_flag_state with a NEWER computedAt. This second
    // event is queued for (T0+2s)+8s = T0+10s, which is NOT yet due when the first event fires below.
    vi.advanceTimersByTime(2_000);
    await onPlayEvent(
      p.onPlayEventDeps,
      makePlay({ playId: 'play-2', yardsToOpponentEndzone: 15 }),
    );
    expect(p.queue.size()).toBe(2);

    // Advance to exactly the FIRST event's scheduledFireAt (T0 + 8s) — the second event
    // (due at T0 + 10s) is not due yet.
    vi.advanceTimersByTime(CBS_LAG_MS - 2_000);
    expect(Date.now()).toBe(T0 + CBS_LAG_MS);

    const result = await runDispatcherTick(p.tickDeps);

    expect(result).toEqual({
      processed: 1,
      delivered: 0,
      droppedStale: 1,
      droppedMissingUser: 0,
      droppedRateLimited: 0,
    });
    expect(p.persistence.records).toHaveLength(0);
    expect(p.realtimeBus.published).toHaveLength(0);
    // The superseding event is still queued, untouched — only the stale one was dropped.
    expect(p.queue.size()).toBe(1);
    expect((await p.queue.due(T0 + 10_000, 10))[0]?.event.newState.priorityScore).toBe(5);
  });

  it('rate limit: a 4th event within 60s is dropped, the first 3 are delivered', async () => {
    const p = buildPipeline();
    await p.gameStateStore.markUserActive(USER_ID, 10 * 60_000);

    // Alternates flag_added/flag_removed (KC has the ball, then LV has the ball) so every play
    // produces a fresh, deliverable event without needing priority-delta bookkeeping. Each event is
    // fully processed (queued -> advanced to its fire time -> ticked) before the next play fires, so
    // no event is ever superseded before its own delivery.
    for (let i = 0; i < 4; i += 1) {
      const play =
        i % 2 === 0
          ? makePlay({ playId: `play-${i}` })
          : makeAwayPossessionPlay({ playId: `play-${i}` });
      await onPlayEvent(p.onPlayEventDeps, play);
      vi.advanceTimersByTime(CBS_LAG_MS);

      const result = await runDispatcherTick(p.tickDeps);
      if (i < 3) {
        expect(result.delivered).toBe(1);
      } else {
        expect(result.droppedRateLimited).toBe(1);
      }
    }

    // All four plays happened within 3 * 8s = 24s of each other — well inside the 60s sliding window.
    expect(p.persistence.records).toHaveLength(3);
    expect(p.realtimeBus.published).toHaveLength(3);
    expect(p.queue.size()).toBe(0); // the rate-limited 4th event is still removed from the queue
  });
});
