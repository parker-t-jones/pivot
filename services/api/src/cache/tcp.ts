import type { Redis } from 'ioredis';
import {
  deserializeUserLineupCache,
  serializeUserLineupCache,
  type SerializedUserLineupCache,
  type UserLineupCache,
} from '@pivot/shared';
import type { LineupCacheProvider, NflState } from './types.js';

const NFL_STATE_KEY = 'current_nfl_state';

function lineupCacheKey(userId: string, week: number): string {
  return `user_lineup_cache:${userId}:${week}`;
}

function stakeKey(teamId: string): string {
  return `users_with_stake:${teamId}`;
}

function isNflState(value: unknown): value is NflState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state['season'] === 'string' &&
    typeof state['week'] === 'number' &&
    (state['seasonType'] === 'pre' ||
      state['seasonType'] === 'regular' ||
      state['seasonType'] === 'post' ||
      state['seasonType'] === 'off') &&
    (state['seasonStartDate'] === null || typeof state['seasonStartDate'] === 'string')
  );
}

/**
 * ioredis lineup cache. Same keys as `RedisLineupCache`, so a worker writing here and a runner
 * reading `user_lineup_cache` / `users_with_stake` share one Redis. Values are JSON strings;
 * Upstash's client JSON-encodes objects itself, and ioredis does not.
 */
export class TcpLineupCache implements LineupCacheProvider {
  constructor(private readonly redis: Redis) {}

  async setLineupCache(userId: string, week: number, cache: UserLineupCache): Promise<void> {
    await this.redis.set(
      lineupCacheKey(userId, week),
      JSON.stringify(serializeUserLineupCache(cache)),
    );
  }

  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    const raw = await this.redis.get(lineupCacheKey(userId, week));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return deserializeUserLineupCache(parsed as SerializedUserLineupCache);
  }

  async addUserStake(teamId: string, userId: string): Promise<void> {
    await this.redis.sadd(stakeKey(teamId), userId);
  }

  async removeUserStake(teamId: string, userId: string): Promise<void> {
    await this.redis.srem(stakeKey(teamId), userId);
  }

  async getUsersWithStake(teamId: string): Promise<string[]> {
    return this.redis.smembers(stakeKey(teamId));
  }

  async getNflState(): Promise<NflState | null> {
    const raw = await this.redis.get(NFL_STATE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isNflState(parsed) ? parsed : null;
  }

  async setNflState(state: NflState, ttlSec: number): Promise<void> {
    await this.redis.set(NFL_STATE_KEY, JSON.stringify(state), 'EX', ttlSec);
  }
}
