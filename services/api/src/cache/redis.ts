import { replaceUserStakes, removeUserIndexes, type UserIndexRedis } from './userCleanup.js';
import { Redis } from '@upstash/redis';
import {
  deserializeUserLineupCache,
  serializeUserLineupCache,
  type SerializedUserLineupCache,
  type UserLineupCache,
} from '@pivot/shared';
import { LINEUP_CACHE_KEY_TTL_SECONDS, type LineupCacheProvider, type NflState } from './types.js';

const NFL_STATE_KEY = 'current_nfl_state';

function lineupCacheKey(userId: string, week: number): string {
  return `user_lineup_cache:${userId}:${week}`;
}

function stakeKey(teamId: string): string {
  return `users_with_stake:${teamId}`;
}

function betKey(gameId: string): string {
  return `users_with_bet:${gameId}`;
}

function betGamesKey(userId: string, week: number): string {
  return `user_bet_games:${userId}:${week}`;
}

/** Upstash-backed implementation of the Section 7 Redis hot-path schemas. */
export class RedisLineupCache implements LineupCacheProvider {
  constructor(private readonly redis: Redis) {}

  async setLineupCache(userId: string, week: number, cache: UserLineupCache): Promise<void> {
    await this.redis.set(lineupCacheKey(userId, week), serializeUserLineupCache(cache), {
      ex: LINEUP_CACHE_KEY_TTL_SECONDS,
    });
  }

  async getLineupCache(userId: string, week: number): Promise<UserLineupCache | null> {
    const serialized = await this.redis.get<SerializedUserLineupCache>(
      lineupCacheKey(userId, week),
    );
    return serialized ? deserializeUserLineupCache(serialized) : null;
  }

  private userIndexes(): UserIndexRedis {
    return {
      scan: async (cursor, pattern) => {
        const [next, keys] = await this.redis.scan(cursor, { match: pattern, count: 100 });
        return [String(next), keys];
      },
      sadd: (key, userId) => this.redis.sadd(key, userId),
      srem: (key, userId) => this.redis.srem(key, userId),
      del: (key) => this.redis.del(key),
      zrem: (key, userId) => this.redis.zrem(key, userId),
    };
  }

  async replaceUserStakes(userId: string, teamIds: readonly string[]): Promise<void> {
    await replaceUserStakes(this.userIndexes(), userId, teamIds);
  }

  async removeUser(userId: string): Promise<void> {
    await removeUserIndexes(this.userIndexes(), userId);
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

  async addUserBet(gameId: string, userId: string, week: number): Promise<void> {
    await this.redis.sadd(betKey(gameId), userId);
    await this.redis.expire(betKey(gameId), LINEUP_CACHE_KEY_TTL_SECONDS);
    await this.redis.sadd(betGamesKey(userId, week), gameId);
    await this.redis.expire(betGamesKey(userId, week), LINEUP_CACHE_KEY_TTL_SECONDS);
  }

  async removeUserBet(gameId: string, userId: string, week: number): Promise<void> {
    await this.redis.srem(betKey(gameId), userId);
    await this.redis.srem(betGamesKey(userId, week), gameId);
  }

  async getUsersWithBet(gameId: string): Promise<string[]> {
    return await this.redis.smembers(betKey(gameId));
  }

  async getUserBetGames(userId: string, week: number): Promise<string[]> {
    return await this.redis.smembers(betGamesKey(userId, week));
  }

  async getNflState(): Promise<NflState | null> {
    return await this.redis.get<NflState>(NFL_STATE_KEY);
  }

  async setNflState(state: NflState, ttlSec: number): Promise<void> {
    await this.redis.set(NFL_STATE_KEY, state, { ex: ttlSec });
  }
}
