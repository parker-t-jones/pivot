import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlagState, GameState } from '@pivot/shared';
import { InMemoryGameStateStore } from './inMemoryGameStateStore.js';

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g1',
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    unitOnField: 'offense',
    scoreHome: 7,
    scoreAway: 10,
    quarter: 2,
    timeRemainingSec: 430,
    yardsToOpponentEndzone: null,
    down: null,
    distance: null,
    inRedZone: false,
    status: 'in_progress',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 4,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['kc-off'] }],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('InMemoryGameStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips game state and flag state', async () => {
    const store = new InMemoryGameStateStore();
    await store.setGameState('g1', makeGameState());
    await store.setUserFlagState('u1', 'g1', makeFlagState());

    expect(await store.getGameState('g1')).toEqual(makeGameState());
    expect(await store.getGameState('missing')).toBeNull();
    expect(await store.getUserFlagState('u1', 'g1')).toEqual(makeFlagState());
    expect(await store.getUserFlagState('u1', 'missing')).toBeNull();
  });

  it('reads stakes seeded per team', async () => {
    const store = new InMemoryGameStateStore();
    store.addStake('KC', 'u1');
    store.addStake('KC', 'u2');
    store.addStake('LV', 'u1');

    expect((await store.getUsersWithStakeIn('KC')).sort()).toEqual(['u1', 'u2']);
    expect(await store.getUsersWithStakeIn('LV')).toEqual(['u1']);
    expect(await store.getUsersWithStakeIn('SF')).toEqual([]);
  });

  it('treats a user as active until the TTL expires', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('u1', 5 * 60 * 1000);

    expect(await store.isUserActive('u1')).toBe(true);
    expect(await store.getActiveUsers()).toEqual(['u1']);

    // Active while now <= expiry (membership is `score >= now`), inactive strictly after.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(await store.isUserActive('u1')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(await store.isUserActive('u1')).toBe(false);
    expect(await store.getActiveUsers()).toEqual([]);
  });

  it('removes an active user immediately (disconnect)', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('u1', 5 * 60 * 1000);
    await store.removeActiveUser('u1');
    expect(await store.isUserActive('u1')).toBe(false);
  });

  it('sweeps expired members but keeps live ones', async () => {
    const store = new InMemoryGameStateStore();
    await store.markUserActive('short', 1000);
    await store.markUserActive('long', 60_000);

    vi.advanceTimersByTime(2000);
    await store.sweepExpiredActiveUsers();

    expect(await store.isUserActive('short')).toBe(false);
    expect(await store.isUserActive('long')).toBe(true);
  });

  it('keeps a device active when one of two connections closes', async () => {
    const store = new InMemoryGameStateStore();
    const deviceId = '11111111-1111-4111-8111-111111111111';
    const connection = {
      userId: 'u1',
      deviceId,
      platform: 'ios' as const,
      visibility: 'visible' as const,
    };
    await store.markConnectionActive({ ...connection, connectionId: 'c1' }, 60_000);
    await store.markConnectionActive({ ...connection, connectionId: 'c2' }, 60_000);
    await store.removeConnection('u1', 'c1');

    expect(await store.isDeviceActive('u1', deviceId)).toBe(true);
    expect(await store.isUserActive('u1')).toBe(true);
    expect(await store.getActiveUsers()).toEqual(['u1']);

    await store.removeConnection('u1', 'c2');
    expect(await store.isDeviceActive('u1', deviceId)).toBe(false);
    expect(await store.isUserActive('u1')).toBe(false);
  });

  it('does not count a hidden web connection, and leaves an iOS device alone', async () => {
    const store = new InMemoryGameStateStore();
    const webDevice = '22222222-2222-4222-8222-222222222222';
    const iosDevice = '33333333-3333-4333-8333-333333333333';
    await store.markConnectionActive(
      {
        userId: 'u1',
        deviceId: webDevice,
        connectionId: 'web',
        platform: 'web',
        visibility: 'visible',
      },
      60_000,
    );
    expect(await store.isDeviceActive('u1', webDevice)).toBe(true);
    expect(await store.isDeviceActive('u1', iosDevice)).toBe(false);
    expect(await store.isUserActive('u1')).toBe(true);

    await store.markConnectionActive(
      {
        userId: 'u1',
        deviceId: webDevice,
        connectionId: 'web',
        platform: 'web',
        visibility: 'hidden',
      },
      60_000,
    );
    expect(await store.isDeviceActive('u1', webDevice)).toBe(false);
    expect(await store.isUserActive('u1')).toBe(false);

    await store.markUserActive('u1', 60_000);
    expect(await store.isDeviceActive('u1', 'legacy-ios')).toBe(true);
    expect(await store.isDeviceActive('u1', webDevice)).toBe(false);
    expect(await store.isUserActive('u1')).toBe(true);
  });

  it('expires a connection by score the same way as a legacy member', async () => {
    const store = new InMemoryGameStateStore();
    const deviceId = '44444444-4444-4444-8444-444444444444';
    await store.markConnectionActive(
      {
        userId: 'u1',
        deviceId,
        connectionId: 'c1',
        platform: 'ios',
        visibility: 'visible',
      },
      1000,
    );

    vi.advanceTimersByTime(1000);
    expect(await store.isDeviceActive('u1', deviceId)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await store.isDeviceActive('u1', deviceId)).toBe(false);
    expect(await store.isUserActive('u1')).toBe(false);

    await store.sweepExpiredActiveUsers();
    expect(await store.getActiveUsers()).toEqual([]);
  });

  it('prunes a dead connection on the next write and drops the key once it is idle', async () => {
    const store = new InMemoryGameStateStore();
    const userId = 'u1';
    const dead = '11111111-1111-4111-8111-111111111111';
    const live = '22222222-2222-4222-8222-222222222222';
    await store.markConnectionActive(
      { userId, deviceId: dead, connectionId: 'old', platform: 'ios', visibility: 'visible' },
      1_000,
    );
    vi.advanceTimersByTime(500);
    await store.markConnectionActive(
      { userId, deviceId: live, connectionId: 'new', platform: 'ios', visibility: 'visible' },
      5_000,
    );
    vi.advanceTimersByTime(501);
    store.takePresenceCommands();
    await store.markConnectionActive(
      { userId, deviceId: live, connectionId: 'new', platform: 'ios', visibility: 'visible' },
      5_000,
    );

    const pruneCommands = store.takePresenceCommands();
    const prunedAt = pruneCommands.findIndex((command) => command === 'zremrangebyscore presence:u1');
    const deletedAt = pruneCommands.findIndex((command) => command === 'hdel presence-vis:u1');
    const writtenAt = pruneCommands.findIndex((command) => command.startsWith('zadd presence:u1'));
    expect(prunedAt).toBeGreaterThanOrEqual(0);
    expect(deletedAt).toBeGreaterThan(prunedAt);
    expect(writtenAt).toBeGreaterThan(deletedAt);
    expect(store.presenceMembers(userId)).toEqual([`${live}|new|ios`]);
    expect(store.presenceVisibility(userId)).toEqual({ new: 'visible' });
    expect(await store.isDeviceActive(userId, dead)).toBe(false);

    await store.removeConnection(userId, 'new');
    expect(store.hasPresenceKey(userId)).toBe(false);

    await store.markConnectionActive(
      { userId, deviceId: live, connectionId: 'idle', platform: 'ios', visibility: 'visible' },
      1_000,
    );
    vi.advanceTimersByTime(1_001);
    expect(store.hasPresenceKey(userId)).toBe(false);
    expect(await store.isUserActive(userId)).toBe(false);
  });

  it('reads only that user\'s presence key', async () => {
    const store = new InMemoryGameStateStore();
    await store.markConnectionActive(
      {
        userId: 'user-b',
        deviceId: '22222222-2222-4222-8222-222222222222',
        connectionId: 'b',
        platform: 'ios',
        visibility: 'visible',
      },
      60_000,
    );
    store.takePresenceCommands();

    expect(await store.isUserActive('user-a')).toBe(false);
    expect(await store.isDeviceActive('user-a', '11111111-1111-4111-8111-111111111111')).toBe(false);
    const commands = store.takePresenceCommands();
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command.includes('presence:user-a'))).toBe(true);
    expect(commands.some((command) => command.includes('user-b') || command.includes('active_users'))).toBe(false);
  });

  it('keeps one member and one visibility field when a connection flips to hidden', async () => {
    const store = new InMemoryGameStateStore();
    const connection = {
      userId: 'u1',
      deviceId: '22222222-2222-4222-8222-222222222222',
      connectionId: 'web',
      platform: 'web' as const,
      visibility: 'visible' as const,
    };
    await store.markConnectionActive(connection, 60_000);
    store.takePresenceCommands();
    await store.markConnectionActive({ ...connection, visibility: 'hidden' }, 60_000);

    expect(store.presenceMembers('u1')).toEqual([`${connection.deviceId}|web|web`]);
    expect(store.presenceVisibility('u1')).toEqual({ web: 'hidden' });
    const commands = store.takePresenceCommands();
    const hset = commands.findIndex((command) => command.startsWith('hset '));
    const zadd = commands.findIndex((command) => command.startsWith('zadd '));
    expect(hset).toBeGreaterThanOrEqual(0);
    expect(zadd).toBeGreaterThan(hset);
    expect(await store.isDeviceActive('u1', connection.deviceId)).toBe(false);
  });
});
