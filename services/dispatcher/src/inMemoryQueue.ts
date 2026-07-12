import type { FlagEvent } from '@fantasy-focus/shared';
import type { FlagEventQueue, QueuedFlagEvent } from './queue.js';

/** In-memory `FlagEventQueue` for local dev and the standard test suite (decision #2). */
export class InMemoryFlagEventQueue implements FlagEventQueue {
  private readonly entries = new Map<string, FlagEvent>();

  async enqueue(event: FlagEvent): Promise<void> {
    this.entries.set(JSON.stringify(event), event);
  }

  async due(now: number, limit: number): Promise<QueuedFlagEvent[]> {
    return [...this.entries.entries()]
      .filter(([, event]) => event.scheduledFireAt <= now)
      .sort((a, b) => a[1].scheduledFireAt - b[1].scheduledFireAt)
      .slice(0, limit)
      .map(([raw, event]) => ({ raw, event }));
  }

  async remove(item: QueuedFlagEvent): Promise<void> {
    this.entries.delete(item.raw);
  }

  /** Test/inspection helper — not part of the interface. */
  size(): number {
    return this.entries.size;
  }
}
