import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePreferences,
  type AiringNetwork,
  type FlagEvent,
  type FlagState,
  type WeekGameAirings,
} from '@pivot/shared';
import { createAlertDelay } from './alertDelay.js';
import { InMemoryBroadcastCatalog } from './broadcastLag.js';
import {
  InMemoryFlagEventPersistence,
  InMemoryGameCatalog,
  InMemoryPlayerCatalog,
  InMemoryUserDirectory,
  type DispatchUser,
} from './catalogs.js';
import { runDispatcherTick, type DispatcherTickDeps } from './dispatcher.js';
import { InMemoryFlagEventQueue } from './inMemoryQueue.js';
import { NoOpPushNotifier } from './pushNotifier.js';
import { InMemoryGameStateStore } from './providers/inMemoryGameStateStore.js';
import { InMemoryRateLimitStore } from './rateLimiter.js';
import { InMemoryRealtimeBus } from './realtimeBus.js';
import { ResumptionGatedDispatcher } from './resumptionGate.js';

function game(id: string, networks: AiringNetwork[]): WeekGameAirings {
  return {
    id,
    kickoff: new Date('2026-11-08T18:00:00Z'),
    airings: networks.map((network) => ({
      network,
      market: 'national',
      espnMediaName: network.toUpperCase(),
      espnType: 'TV',
    })),
  };
}

/** `g1` is a national FOX game (YouTube TV carries it); `tnf` is Prime only. */
const WEEK: WeekGameAirings[] = [game('g1', ['fox']), game('tnf', ['amazon_prime'])];

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 0,
    ...overrides,
  };
}

function makeUser(id: string, alertTiming: unknown = undefined): DispatchUser {
  return {
    id,
    subscriptionTier: 'free',
    preferences: parsePreferences(alertTiming === undefined ? {} : { alertTiming }),
    expoPushToken: null,
  };
}

function setup() {
  const users = new InMemoryUserDirectory();
  const broadcasts = new InMemoryBroadcastCatalog();
  broadcasts.setWeekAirings(WEEK);
  const now = { value: 1_000_000 };
  const delay = createAlertDelay({ users, broadcasts, clock: () => now.value });
  return { users, broadcasts, now, delay };
}

describe('createAlertDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is 0 for a user on the defaults', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(makeUser('u1'));
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    expect(await delay(makeEvent())).toBe(0);
  });

  it('uses the default when the user has no overrides', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(makeUser('u1', { defaultDelaySeconds: 20 }));
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    expect(await delay(makeEvent())).toBe(20_000);
  });

  it('uses the override for the service the alert routes to', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(
      makeUser('u1', { defaultDelaySeconds: 20, serviceDelaySeconds: { youtube_tv: 45 } }),
    );
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    expect(await delay(makeEvent())).toBe(45_000);
  });

  it('honors an override of On time below a nonzero default', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(
      makeUser('u1', { defaultDelaySeconds: 30, serviceDelaySeconds: { youtube_tv: 0 } }),
    );
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    expect(await delay(makeEvent())).toBe(0);
  });

  it('falls back to the default when the destination service has no override', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(
      makeUser('u1', { defaultDelaySeconds: 15, serviceDelaySeconds: { peacock: 60 } }),
    );
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv', 'peacock']);
    expect(await delay(makeEvent())).toBe(15_000);
  });

  it('applies the override on the game it routes to and not on another', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(
      makeUser('u1', { defaultDelaySeconds: 10, serviceDelaySeconds: { amazon_prime: 40 } }),
    );
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv', 'amazon_prime']);
    expect(await delay(makeEvent({ gameId: 'tnf' }))).toBe(40_000);
    expect(await delay(makeEvent({ gameId: 'g1' }))).toBe(10_000);
  });

  it('uses the default when no service of the user carries the game', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(
      makeUser('u1', { defaultDelaySeconds: 25, serviceDelaySeconds: { youtube_tv: 60 } }),
    );
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    expect(await delay(makeEvent({ gameId: 'tnf' }))).toBe(25_000);
  });

  it('is 0 for an unknown user', async () => {
    const { delay } = setup();
    expect(await delay(makeEvent({ userId: 'ghost' }))).toBe(0);
  });

  it('skips the airings lookup when nothing can add a delay', async () => {
    const { users, broadcasts, delay } = setup();
    users.setUser(makeUser('u1', { defaultDelaySeconds: 0, serviceDelaySeconds: { fubo: 0 } }));
    const airings = vi.spyOn(broadcasts, 'getWeekAirings');
    expect(await delay(makeEvent())).toBe(0);
    expect(airings).not.toHaveBeenCalled();
  });

  it('is 0, and logs, when a lookup fails', async () => {
    const { users, delay } = setup();
    vi.spyOn(users, 'getUser').mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await delay(makeEvent())).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('reuses a result for the same user and game until the cache expires', async () => {
    const { users, broadcasts, now, delay } = setup();
    users.setUser(makeUser('u1', { defaultDelaySeconds: 20 }));
    broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    const getUser = vi.spyOn(users, 'getUser');

    expect(await delay(makeEvent())).toBe(20_000);
    users.setUser(makeUser('u1', { defaultDelaySeconds: 50 }));
    now.value += 29_000;
    expect(await delay(makeEvent())).toBe(20_000);
    expect(getUser).toHaveBeenCalledTimes(1);

    now.value += 2_000;
    expect(await delay(makeEvent())).toBe(50_000);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});

describe('alert delay through the gate and the dispatcher tick', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pipeline() {
    const now = { value: 1_700_000_000_000 };
    const clock = () => now.value;
    const queue = new InMemoryFlagEventQueue();
    const users = new InMemoryUserDirectory();
    const broadcasts = new InMemoryBroadcastCatalog();
    broadcasts.setWeekAirings(WEEK);
    const gameStateStore = new InMemoryGameStateStore();
    const rateLimitStore = new InMemoryRateLimitStore();
    const realtimeBus = new InMemoryRealtimeBus();
    const persistence = new InMemoryFlagEventPersistence();
    const gate = new ResumptionGatedDispatcher({
      queue,
      onGated: () => undefined,
      clock,
      fireDelayMs: createAlertDelay({ users, broadcasts, clock }),
    });
    const tickDeps: DispatcherTickDeps = {
      queue,
      gameStateStore,
      userDirectory: users,
      rateLimitStore,
      clock,
      delivery: {
        gameStateStore,
        gameCatalog: new InMemoryGameCatalog(),
        playerCatalog: new InMemoryPlayerCatalog(),
        broadcastCatalog: broadcasts,
        userDirectory: users,
        persistence,
        realtimeBus,
        rateLimitStore,
        pushNotifier: new NoOpPushNotifier(),
        clock,
      },
    };
    return {
      now,
      queue,
      users,
      broadcasts,
      gameStateStore,
      rateLimitStore,
      realtimeBus,
      persistence,
      gate,
      tick: () => runDispatcherTick(tickDeps),
    };
  }

  /** The possession nudge on the play that ends the drive (#7), for one user. */
  function nudge(userId: string): FlagEvent {
    return makeEvent({ id: `evt-${userId}`, userId, trigger: 'possession' });
  }

  it('fires the same flag for two users at their own times', async () => {
    const p = pipeline();
    p.users.setUser(makeUser('u1'));
    p.users.setUser(makeUser('u2', { serviceDelaySeconds: { youtube_tv: 30 } }));
    p.broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    p.broadcasts.setUserSubscribedServices('u2', ['youtube_tv']);
    for (const userId of ['u1', 'u2']) {
      await p.gameStateStore.setUserFlagState(userId, 'g1', makeFlagState());
      await p.gameStateStore.markUserActive(userId, 600_000);
    }
    const start = p.now.value;

    p.gate.beginPlay('g1', 'punt');
    await p.gate.dispatch(nudge('u1'), 'play-punt');
    await p.gate.dispatch(nudge('u2'), 'play-punt');
    await p.gate.endPlay('g1');

    const scheduled = new Map(
      (await p.queue.due(Number.MAX_SAFE_INTEGER, 10)).map((item) => [
        item.event.userId,
        item.event.scheduledFireAt,
      ]),
    );
    expect(scheduled.get('u1')).toBe(start);
    expect(scheduled.get('u2')).toBe(start + 30_000);

    expect((await p.tick()).delivered).toBe(1);
    expect(p.realtimeBus.published.map((m) => m.channel)).toEqual(['realtime:user:u1']);

    p.now.value = start + 29_500;
    expect((await p.tick()).delivered).toBe(0);

    p.now.value = start + 30_000;
    expect((await p.tick()).delivered).toBe(1);
    expect(p.realtimeBus.published.map((m) => m.channel)).toEqual([
      'realtime:user:u1',
      'realtime:user:u2',
    ]);
    expect(p.persistence.records.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('still rate-limits a delayed alert at fire time', async () => {
    const p = pipeline();
    p.users.setUser(makeUser('u1', { defaultDelaySeconds: 45 }));
    p.broadcasts.setUserSubscribedServices('u1', ['youtube_tv']);
    await p.gameStateStore.setUserFlagState('u1', 'g1', makeFlagState());
    await p.gameStateStore.markUserActive('u1', 600_000);
    const start = p.now.value;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    p.gate.beginPlay('g1', 'punt');
    await p.gate.dispatch(nudge('u1'), 'play-punt');
    await p.gate.endPlay('g1');

    // The window was empty at enqueue. Three other alerts land while this one waits.
    for (const [index, at] of [start + 10_000, start + 20_000, start + 30_000].entries()) {
      await p.rateLimitStore.recordNotification('u1', `other-${index}`, at);
    }

    p.now.value = start + 45_000;
    const result = await p.tick();
    expect(result.droppedRateLimited).toBe(1);
    expect(result.delivered).toBe(0);
    expect(p.realtimeBus.published).toHaveLength(0);
  });
});
