import type { FlagEvent } from '@pivot/shared';
import { serializeQueuedFlagEvent, type FlagEventQueue, type QueuedFlagEvent } from './queue.js';

interface StoredQueueEntry {
  event: FlagEvent;
  triggeringPlayId: string | null;
}

/** In-memory `FlagEventQueue` for local dev and the standard test suite (decision #2). */
export class InMemoryFlagEventQueue implements FlagEventQueue {
  private readonly entries = new Map<string, StoredQueueEntry>();

  async enqueue(event: FlagEvent, triggeringPlayId: string | null = null): Promise<void> {
    this.entries.set(serializeQueuedFlagEvent(event, triggeringPlayId), {
      event,
      triggeringPlayId,
    });
  }

  async due(now: number, limit: number): Promise<QueuedFlagEvent[]> {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.event.scheduledFireAt <= now)
      .sort((a, b) => a[1].event.scheduledFireAt - b[1].event.scheduledFireAt)
      .slice(0, limit)
      .map(([raw, entry]) => ({
        raw,
        event: entry.event,
        triggeringPlayId: entry.triggeringPlayId,
      }));
  }

  async remove(item: QueuedFlagEvent): Promise<void> {
    this.entries.delete(item.raw);
  }

  /** Test/inspection helper — not part of the interface. */
  size(): number {
    return this.entries.size;
  }
}
