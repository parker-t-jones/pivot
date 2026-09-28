import { Redis } from 'ioredis';
import type { LineupCacheReader } from '@pivot/engine';
import type { FlagState, GameState } from '@pivot/shared';
import { deserializeUserLineupCache, type SerializedUserLineupCache } from '@pivot/shared';
import {
  deserializeFlagState,
  deserializeGameState,
  GAME_STATE_KEY_TTL_SECONDS,
  NOTIFICATIONS_KEY_TTL_SECONDS,
  parseQueuedFlagEvent,
  serializeFlagState,
  serializeGameState,
  serializeQueuedFlagEvent,
  type FlagEventQueue,
  type GameStateStore,
  type QueuedFlagEvent,
  type RateLimitStore,
  type RealtimeBus,
  type ResumptionOpenRecord,
  type ResumptionOpenStore,
} from '@pivot/dispatcher';
import type { FlagEvent } from '@pivot/shared';
import type { LeaderLockRedis } from './leaderLock.js';
import { espnSeenPlaysKey, type SeenPlaySet } from './seenPlays.js';

const QUEUE_KEY = 'flag_event_queue';
const ACTIVE_USERS_KEY = 'active_users';

const RENEW_IF_MATCH = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3], 'XX')
end
return 0
`;

/** TCP client for Docker Redis or Upstash's TCP URL. Do not point `@upstash/redis` at this port. */
export function createTcpRedis(url: string, label = 'runner'): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  redis.on('error', (error: Error) => {
    console.error(`[${label}] redis: ${error.message}`);
  });
  return redis;
}

/** `REDIS_URL` when set, otherwise the Upstash TCP URL used by the REST fallback. */
export function tcpRedisUrl(env: {
  REDIS_URL?: string | undefined;
  UPSTASH_REDIS_TCP_URL?: string | undefined;
}): string | undefined {
  return env.REDIS_URL ?? env.UPSTASH_REDIS_TCP_URL;
}

export function tcpLeaderLock(redis: Redis): LeaderLockRedis {
  return {
    async incr(key: string): Promise<number> {
      return redis.incr(key);
    },
    async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
      const result = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    },
    async setXxExIfMatch(
      key: string,
      expected: string,
      value: string,
      ttlSeconds: number,
    ): Promise<boolean> {
      const result = await redis.eval(RENEW_IF_MATCH, 1, key, expected, value, String(ttlSeconds));
      return result === 'OK';
    },
    async get(key: string): Promise<string | null> {
      return redis.get(key);
    },
  };
}

export function tcpSeenPlays(redis: Redis): SeenPlaySet {
  return {
    async add(espnEventId: string, playId: string): Promise<void> {
      await redis.sadd(espnSeenPlaysKey(espnEventId), playId);
    },
    async has(espnEventId: string, playId: string): Promise<boolean> {
      const found = await redis.sismember(espnSeenPlaysKey(espnEventId), playId);
      return found === 1;
    },
    async members(espnEventId: string): Promise<ReadonlySet<string>> {
      const ids = await redis.smembers(espnSeenPlaysKey(espnEventId));
      return new Set(ids);
    },
  };
}

export function tcpFlagEventQueue(redis: Redis): FlagEventQueue {
  return {
    async enqueue(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
      await redis.zadd(
        QUEUE_KEY,
        event.scheduledFireAt,
        serializeQueuedFlagEvent(event, triggeringPlayId),
      );
    },
    async due(now: number, limit: number): Promise<QueuedFlagEvent[]> {
      const members = await redis.zrangebyscore(QUEUE_KEY, 0, now, 'LIMIT', 0, limit);
      return members.map((raw) => {
        const parsed = parseQueuedFlagEvent(raw);
        return { raw, event: parsed.event, triggeringPlayId: parsed.triggeringPlayId };
      });
    },
    async remove(item: QueuedFlagEvent): Promise<void> {
      await redis.zrem(QUEUE_KEY, item.raw);
    },
  };
}

export function tcpResumptionOpenStore(redis: Redis): ResumptionOpenStore {
  return {
    async put(key: string, record: ResumptionOpenRecord): Promise<void> {
      await redis.set(key, JSON.stringify(record));
    },
    async delete(key: string): Promise<void> {
      await redis.del(key);
    },
    async read(key: string): Promise<ResumptionOpenRecord | null> {
      const raw = await redis.get(key);
      if (raw === null) return null;
      return parseResumptionOpen(raw);
    },
  };
}

export function tcpGameState(redis: Redis): GameStateStore {
  return {
    async getGameState(gameId: string): Promise<GameState | null> {
      const raw = await redis.hgetall(gameStateKey(gameId));
      if (Object.keys(raw).length === 0) return null;
      return deserializeGameState(raw);
    },
    async setGameState(gameId: string, state: GameState): Promise<void> {
      const key = gameStateKey(gameId);
      await redis.hset(key, serializeGameState(state));
      await redis.expire(key, GAME_STATE_KEY_TTL_SECONDS);
    },
    async getUserFlagState(userId: string, gameId: string): Promise<FlagState | null> {
      const raw = await redis.hgetall(userFlagStateKey(userId, gameId));
      if (Object.keys(raw).length === 0) return null;
      return deserializeFlagState(raw);
    },
    async setUserFlagState(userId: string, gameId: string, state: FlagState): Promise<void> {
      await redis.hset(userFlagStateKey(userId, gameId), serializeFlagState(state));
    },
    async getActiveUsers(): Promise<string[]> {
      return redis.zrangebyscore(ACTIVE_USERS_KEY, Date.now(), '+inf');
    },
    async getUsersWithStakeIn(teamId: string): Promise<string[]> {
      return redis.smembers(stakeKey(teamId));
    },
    async markUserActive(userId: string, ttlMs: number): Promise<void> {
      await redis.zadd(ACTIVE_USERS_KEY, Date.now() + ttlMs, userId);
    },
    async removeActiveUser(userId: string): Promise<void> {
      await redis.zrem(ACTIVE_USERS_KEY, userId);
    },
    async isUserActive(userId: string): Promise<boolean> {
      const score = await redis.zscore(ACTIVE_USERS_KEY, userId);
      if (score === null) return false;
      return Number(score) >= Date.now();
    },
    async sweepExpiredActiveUsers(): Promise<void> {
      await redis.zremrangebyscore(ACTIVE_USERS_KEY, 0, Date.now() - 1);
    },
  };
}

export function tcpRateLimit(redis: Redis): RateLimitStore {
  return {
    async countRecentNotifications(
      userId: string,
      sinceMs: number,
      untilMs: number,
    ): Promise<number> {
      return redis.zcount(notificationsKey(userId), sinceMs, untilMs);
    },
    async recordNotification(
      userId: string,
      eventId: string,
      deliveredAtMs: number,
    ): Promise<void> {
      const key = notificationsKey(userId);
      await redis.zadd(key, deliveredAtMs, eventId);
      await redis.expire(key, NOTIFICATIONS_KEY_TTL_SECONDS);
    },
  };
}

export function tcpRealtimeBus(redis: Redis): RealtimeBus {
  return {
    async publish(channel: string, message: unknown): Promise<void> {
      await redis.publish(channel, JSON.stringify(message));
    },
  };
}

export function tcpLineupCache(redis: Redis): LineupCacheReader {
  return {
    async getLineupCache(userId: string, week: number) {
      const raw = await redis.get(lineupCacheKey(userId, week));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      return deserializeUserLineupCache(parsed as SerializedUserLineupCache);
    },
  };
}

function gameStateKey(gameId: string): string {
  return `game_state:${gameId}`;
}

function userFlagStateKey(userId: string, gameId: string): string {
  return `user_flag_state:${userId}:${gameId}`;
}

function stakeKey(teamId: string): string {
  return `users_with_stake:${teamId}`;
}

function notificationsKey(userId: string): string {
  return `user_notifications:${userId}`;
}

function lineupCacheKey(userId: string, week: number): string {
  return `user_lineup_cache:${userId}:${week}`;
}

function parseResumptionOpen(raw: string): ResumptionOpenRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const openedAt = record['openedAt'];
  const revealingPlayId = record['revealingPlayId'];
  if (typeof openedAt !== 'number' || typeof revealingPlayId !== 'string') return null;
  return { openedAt, revealingPlayId };
}
