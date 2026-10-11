import type { Redis } from '@upstash/redis';
import type { FlagState, GameState } from '@pivot/shared';
import {
  LEGACY_IOS_DEVICE_ID,
  connectionCountsAsActive,
  listLivePresenceConnections,
  removePresenceConnection,
  writePresenceConnection,
  type PresenceConnection,
  type PresenceRedis,
} from '../presence.js';
import type { GameStateStore } from './gameStateStore.js';
import {
  deserializeFlagState,
  deserializeGameState,
  serializeFlagState,
  serializeGameState,
} from './redisSerde.js';

const ACTIVE_USERS_KEY = 'active_users';

/**
 * `game_state:{game_id}` expiry, refreshed on every write. Longer than any game, so a live game
 * never loses its hash, but a run that stops mid-game can't leave one behind indefinitely.
 */
export const GAME_STATE_KEY_TTL_SECONDS = 6 * 60 * 60;

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
function upstashPresence(redis: Redis): PresenceRedis {
  return {
    async zrangeByScore(key, min, max) {
      const upper = max === Number.POSITIVE_INFINITY ? '+inf' : max;
      const members = await redis.zrange<(string | number)[]>(key, min, upper, { byScore: true });
      return members.map((member) => String(member));
    },
    async zremRangeByScore(key, min, max) {
      await redis.zremrangebyscore(key, min, max);
    },
    async zadd(key, score, member) {
      await redis.zadd(key, { score, member });
    },
    async zrem(key, members) {
      for (const member of members) await redis.zrem(key, member);
    },
    async hgetAll(key) {
      const raw = await redis.hgetall<Record<string, unknown>>(key);
      if (!raw) return {};
      return Object.fromEntries(Object.entries(raw).map(([field, value]) => [field, String(value)]));
    },
    async hset(key, field, value) {
      await redis.hset(key, { [field]: value });
    },
    async hdel(key, fields) {
      if (fields.length === 0) return;
      await redis.hdel(key, ...fields);
    },
    async pexpire(key, ttlMs) {
      await redis.pexpire(key, ttlMs);
    },
    async del(keys) {
      if (keys.length === 0) return;
      await redis.del(...keys);
    },
  };
}

export class RedisGameStateProvider implements GameStateStore {
  private readonly presence: PresenceRedis;

  constructor(private readonly redis: Redis) {
    this.presence = upstashPresence(redis);
  }

  async getGameState(gameId: string): Promise<GameState | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(gameStateKey(gameId));
    return raw ? deserializeGameState(raw) : null;
  }

  async setGameState(gameId: string, state: GameState): Promise<void> {
    const key = gameStateKey(gameId);
    await this.redis
      .multi()
      .hset(key, serializeGameState(state))
      .expire(key, GAME_STATE_KEY_TTL_SECONDS)
      .exec();
  }

  async getUserFlagState(userId: string, gameId: string): Promise<FlagState | null> {
    const raw = await this.redis.hgetall<Record<string, unknown>>(userFlagStateKey(userId, gameId));
    return raw ? deserializeFlagState(raw) : null;
  }

  async setUserFlagState(userId: string, gameId: string, state: FlagState): Promise<void> {
    await this.redis.hset(userFlagStateKey(userId, gameId), serializeFlagState(state));
  }

  async getActiveUsers(): Promise<string[]> {
    const members = await this.listLegacyMembers();
    return members.filter((member) => !member.includes('|'));
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

  async removeConnection(userId: string, connectionId: string): Promise<void> {
    await removePresenceConnection(this.presence, userId, connectionId);
  }

  async markConnectionActive(connection: PresenceConnection, ttlMs: number): Promise<void> {
    await writePresenceConnection(this.presence, connection, ttlMs);
  }

  async isUserActive(userId: string): Promise<boolean> {
    const score = await this.redis.zscore(ACTIVE_USERS_KEY, userId);
    if (score !== null && score >= Date.now()) return true;
    const live = await listLivePresenceConnections(this.presence, userId);
    return live.some(connectionCountsAsActive);
  }

  async isDeviceActive(userId: string, deviceId: string): Promise<boolean> {
    if (deviceId === LEGACY_IOS_DEVICE_ID) {
      const score = await this.redis.zscore(ACTIVE_USERS_KEY, userId);
      if (score !== null && score >= Date.now()) return true;
    }
    const live = await listLivePresenceConnections(this.presence, userId);
    return live.some(
      (connection) => connection.deviceId === deviceId && connectionCountsAsActive(connection),
    );
  }

  async sweepExpiredActiveUsers(): Promise<void> {
    // Legacy set only. Per-user keys prune on write and disappear on PEXPIRE.
    await this.redis.zremrangebyscore(ACTIVE_USERS_KEY, 0, Date.now() - 1);
  }

  private async listLegacyMembers(): Promise<string[]> {
    const members = await this.redis.zrange<(string | number)[]>(ACTIVE_USERS_KEY, Date.now(), '+inf', {
      byScore: true,
    });
    return members.map((member) => String(member));
  }
}
