import { Redis } from '@upstash/redis';
import {
  deserializeUserLineupCache,
  serializeUserLineupCache,
  type SerializedUserLineupCache,
  type UserLineupCache,
} from '@fantasy-focus/shared';
import type { LineupCacheProvider, NflState } from './types.js';

const NFL_STATE_KEY = 'current_nfl_state';

function lineupCacheKey(userId: string, week: number): string {
  return `user_lineup_cache:${userId}:${week}`;
}

function stakeKey(teamId: string): string {
  return `users_with_stake:${teamId}`;
}

/** Upstash-backed implementation of the Section 7 Redis hot-path schemas. */
export class RedisLineupCache implements LineupCacheProvider {
  constructor(private readonly redis: Redis) {}

  async setLineupCache(userId: string, week: number, cache: UserLineupCache): Promise<void> {
    await this.redis.set(lineupCacheKey(userId, week), serializeUserLineupCache(cache));
  }

  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    const serialized = await this.redis.get<SerializedUserLineupCache>(
      lineupCacheKey(userId, week),
    );
    return serialized ? deserializeUserLineupCache(serialized) : null;
  }

  async addUserStake(teamId: string, userId: string): Promise<void> {
    await this.redis.sadd(stakeKey(teamId), userId);
  }

  async removeUserStake(teamId: string, userId: string): Promise<void> {
    await this.redis.srem(stakeKey(teamId), userId);
  }

  async getUsersWithStake(teamId: string): Promise<string[]> {
    return await this.redis.smembers(stakeKey(teamId));
  }

  async getNflState(): Promise<NflState | null> {
    return await this.redis.get<NflState>(NFL_STATE_KEY);
  }

  async setNflState(state: NflState, ttlSec: number): Promise<void> {
    await this.redis.set(NFL_STATE_KEY, state, { ex: ttlSec });
  }
}
