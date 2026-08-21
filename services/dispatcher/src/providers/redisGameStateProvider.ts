import type { Redis } from '@upstash/redis';
import type { FlagState, GameState } from '@roster-remote/shared';
import type { GameStateStore } from './gameStateStore.js';
import {
  deserializeFlagState,
  deserializeGameState,
  serializeFlagState,
  serializeGameState,
} from './redisSerde.js';

const ACTIVE_USERS_KEY = 'active_users';

function gameStateKey(gameId: string): string {
  return `game_state:${gameId}`;
}

function userFlagStateKey(userId: string, gameId: string): string {
  return `user_flag_state:${userId}:${gameId}`;
}

function stakeKey(teamId: string): string {
  return `users_with_stake:${teamId}`;
}

/**
 * Upstash-backed `GameStateStore` implementing the Section 7 Redis hot-path schemas. Shares the
 * `users_with_stake:{team_id}` set with Sprint 3's `RedisLineupCache` (that class is the writer; this
 * class only reads it), which is the intended cross-process contract ("no shared state beyond Redis",
 * sprint decision #9).
 *
 * `active_users` is a sorted set scored by expiry-ms (decision #4). `user_flag_state:{user_id}:
 * {game_id}` is a hash (decision #3). Both are documented Section 7 additions/changes applied at the
 * end of the sprint.
 */
export class RedisGameStateProvider implements GameStateStore {
  constructor(private readonly redis: Redis) {}

  async getGameState(gameId: string): Promise<GameState | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(gameStateKey(gameId));
    return raw ? deserializeGameState(raw) : null;
  }

  async setGameState(gameId: string, state: GameState): Promise<void> {
    await this.redis.hset(gameStateKey(gameId), serializeGameState(state));
  }

  async getUserFlagState(userId: string, gameId: string): Promise<FlagState | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(userFlagStateKey(userId, gameId));
    return raw ? deserializeFlagState(raw) : null;
  }

  async setUserFlagState(userId: string, gameId: string, state: FlagState): Promise<void> {
    await this.redis.hset(userFlagStateKey(userId, gameId), serializeFlagState(state));
  }

  async getActiveUsers(): Promise<string[]> {
    const members = await this.redis.zrange<(string | number)[]>(
      ACTIVE_USERS_KEY,
      Date.now(),
      '+inf',
      {
        byScore: true,
      },
    );
    return members.map((m) => String(m));
  }

  async getUsersWithStakeIn(teamId: string): Promise<string[]> {
    return await this.redis.smembers(stakeKey(teamId));
  }

  async markUserActive(userId: string, ttlMs: number): Promise<void> {
    await this.redis.zadd(ACTIVE_USERS_KEY, { score: Date.now() + ttlMs, member: userId });
  }

  async removeActiveUser(userId: string): Promise<void> {
    await this.redis.zrem(ACTIVE_USERS_KEY, userId);
  }

  async isUserActive(userId: string): Promise<boolean> {
    const score = await this.redis.zscore(ACTIVE_USERS_KEY, userId);
    return score !== null && score >= Date.now();
  }

  async sweepExpiredActiveUsers(): Promise<void> {
    // Remove members whose expiry is strictly in the past (score < now); score === now is still live.
    await this.redis.zremrangebyscore(ACTIVE_USERS_KEY, 0, Date.now() - 1);
  }
}
