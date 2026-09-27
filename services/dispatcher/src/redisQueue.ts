import type { Redis } from '@upstash/redis';
import type { FlagEvent } from '@pivot/shared';
import {
  parseQueuedFlagEvent,
  serializeQueuedFlagEvent,
  type FlagEventQueue,
  type QueuedFlagEvent,
} from './queue.js';

const QUEUE_KEY = 'flag_event_queue';

/** Upstash-backed `FlagEventQueue` — `flag_event_queue` sorted set (PLAN.md Section 7). */
export class RedisFlagEventQueue implements FlagEventQueue {
  constructor(private readonly redis: Redis) {}

  async enqueue(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
    await this.redis.zadd(QUEUE_KEY, {
      score: event.scheduledFireAt,
      member: serializeQueuedFlagEvent(event, triggeringPlayId),
    });
  }

  async due(now: number, limit: number): Promise<QueuedFlagEvent[]> {
    const members = await this.redis.zrange<string[]>(QUEUE_KEY, 0, now, {
      byScore: true,
      offset: 0,
      count: limit,
    });
    return members.map((raw) => {
      const parsed = parseQueuedFlagEvent(raw);
      return { raw, event: parsed.event, triggeringPlayId: parsed.triggeringPlayId };
    });
  }

  async remove(item: QueuedFlagEvent): Promise<void> {
    await this.redis.zrem(QUEUE_KEY, item.raw);
  }
}
