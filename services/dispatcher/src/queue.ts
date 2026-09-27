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
  /** ESPN play id the handler passed into dispatch. Null when the member has none. */
  triggeringPlayId: string | null;
}

/**
 * Queue member is `JSON.stringify(event)`, plus `triggeringPlayId` when the handler passed one.
 * That field is not part of `FlagEvent`; `parseQueuedFlagEvent` strips it back off.
 */
export function serializeQueuedFlagEvent(
  event: FlagEvent,
  triggeringPlayId: string | null,
): string {
  if (triggeringPlayId === null) return JSON.stringify(event);
  return JSON.stringify({ ...event, triggeringPlayId });
}

export function parseQueuedFlagEvent(raw: string): {
  event: FlagEvent;
  triggeringPlayId: string | null;
} {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('queued flag event is not an object');
  }
  const record = parsed as Record<string, unknown>;
  const playId = record['triggeringPlayId'];
  const triggeringPlayId = typeof playId === 'string' ? playId : null;
  if (!Object.prototype.hasOwnProperty.call(record, 'triggeringPlayId')) {
    return { event: parsed as FlagEvent, triggeringPlayId: null };
  }
  const eventFields: Record<string, unknown> = { ...record };
  delete eventFields['triggeringPlayId'];
  return { event: eventFields as unknown as FlagEvent, triggeringPlayId };
}

export interface FlagEventQueue {
  /** `scheduleFlagEvent`'s `redis.zadd('flag_event_queue', event.scheduledFireAt, JSON.stringify(event))`. */
  enqueue(event: FlagEvent, triggeringPlayId?: string | null): Promise<void>;
  /** Section 8 `redis.zrangebyscore('flag_event_queue', 0, now, { limit })` — oldest-due first. */
  due(now: number, limit: number): Promise<QueuedFlagEvent[]>;
  /** Section 8 `redis.zrem('flag_event_queue', eventJson)`. */
  remove(item: QueuedFlagEvent): Promise<void>;
}
