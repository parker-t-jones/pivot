import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { afterAll, describe, expect, it } from 'vitest';
import type { GameState } from '@pivot/shared';
import { RedisGameStateProvider } from './redisGameStateProvider.js';

/*
 * CACHE_DRIVER=redis integration test (sprint requirement). Runs against a real Redis (Upstash REST,
 * or a local Redis exposed over the Upstash REST protocol) ONLY when explicitly configured, and
 * skips otherwise — the standard `pnpm test` suite must never require Redis (decision #2).
 *
 * Run with:
 *   CACHE_DRIVER=redis UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... pnpm test
 */

const shouldRun =
  process.env['CACHE_DRIVER'] === 'redis' &&
  !!process.env['UPSTASH_REDIS_REST_URL'] &&
  !!process.env['UPSTASH_REDIS_REST_TOKEN'];

const redis: Redis | null = shouldRun
  ? new Redis({
      url: process.env['UPSTASH_REDIS_REST_URL'] as string,
      token: process.env['UPSTASH_REDIS_REST_TOKEN'] as string,
    })
  : null;

/** Non-null accessor for the guarded describe block (avoids `!` assertions under strict lint). */
function client(): Redis {
  if (!redis) throw new Error('Redis client unavailable — this suite should have been skipped.');
  return redis;
}

const gameId = `test-${randomUUID()}`;
const userId = `test-${randomUUID()}`;
const teamId = `test-${randomUUID()}`;

function makeGameState(): GameState {
  return {
    gameId,
    homeTeamId: 'LV',
    awayTeamId: 'KC',
    possessionTeamId: 'KC',
    unitOnField: 'offense',
    scoreHome: 14,
    scoreAway: 21,
    quarter: 4,
    timeRemainingSec: 92,
    inRedZone: true,
    status: 'in_progress',
    updatedAt: 1_700_000_000_000,
  };
}

describe.skipIf(!shouldRun)('RedisGameStateProvider (integration, real Redis)', () => {
  afterAll(async () => {
    if (!redis) return;
    await Promise.all([
      redis.del(`game_state:${gameId}`),
      redis.del(`user_flag_state:${userId}:${gameId}`),
      redis.del(`users_with_stake:${teamId}`),
      redis.zrem('active_users', userId),
    ]);
  });

  it('round-trips a full GameState through the game_state hash', async () => {
    const provider = new RedisGameStateProvider(client());
    await provider.setGameState(gameId, makeGameState());
    expect(await provider.getGameState(gameId)).toEqual(makeGameState());
  });

  it('round-trips a FlagState through the user_flag_state hash', async () => {
    const provider = new RedisGameStateProvider(client());
    const flagState = {
      gameId,
      flagged: true,
      priorityScore: 9,
      reasons: [
        { type: 'offense_active' as const, triggeringPlayerIds: ['kc-off'] },
        { type: 'red_zone' as const, triggeringPlayerIds: [] },
      ],
      computedAt: 1_700_000_000_000,
    };
    await provider.setUserFlagState(userId, gameId, flagState);
    expect(await provider.getUserFlagState(userId, gameId)).toEqual(flagState);
  });

  it('reads the users_with_stake set written by the lineup cache', async () => {
    await client().sadd(`users_with_stake:${teamId}`, userId);
    expect(await new RedisGameStateProvider(client()).getUsersWithStakeIn(teamId)).toContain(
      userId,
    );
  });

  it('models active_users as an expiry-scored sorted set', async () => {
    const provider = new RedisGameStateProvider(client());

    await provider.markUserActive(userId, 60_000);
    expect(await provider.isUserActive(userId)).toBe(true);
    expect(await provider.getActiveUsers()).toContain(userId);

    // Expiry in the past: no longer active, excluded from getActiveUsers, swept away.
    await provider.markUserActive(userId, -1000);
    expect(await provider.isUserActive(userId)).toBe(false);
    expect(await provider.getActiveUsers()).not.toContain(userId);

    await provider.sweepExpiredActiveUsers();
    expect(await client().zscore('active_users', userId)).toBeNull();
  });
});
