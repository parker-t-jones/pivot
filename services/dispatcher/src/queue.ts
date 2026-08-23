import type { FlagEvent } from '@pivot/shared';

/**
 * `flag_event_queue` (PLAN.md Section 7) — a sorted set of `{ event_json : fire_at_timestamp }`.
 * `raw` carries the exact serialized member string a given event was stored under, so `remove` can
 * `zrem` by exact member match (Section 8's dispatcher loop does `redis.zrem('flag_event_queue',
 * eventJson)` using the very string it just read back — this interface preserves that contract
 * instead of re-serializing, which could drift from the stored member if field order/whitespace ever
 * changed between writes).
 */
export interface QueuedFlagEvent {
  event: FlagEvent;
  raw: string;
}

export interface FlagEventQueue {
  /** `scheduleFlagEvent`'s `redis.zadd('flag_event_queue', event.scheduledFireAt, JSON.stringify(event))`. */
  enqueue(event: FlagEvent): Promise<void>;
  /** Section 8 `redis.zrangebyscore('flag_event_queue', 0, now, { limit })` — oldest-due first. */
  due(now: number, limit: number): Promise<QueuedFlagEvent[]>;
  /** Section 8 `redis.zrem('flag_event_queue', eventJson)`. */
  remove(item: QueuedFlagEvent): Promise<void>;
}
