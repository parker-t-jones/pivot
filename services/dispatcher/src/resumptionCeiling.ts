import { RESUMPTION_CEILING_MS, type ResumptionWindowOpened } from '@pivot/engine';

export interface ResumptionOpenRecord {
  openedAt: number;
  revealingPlayId: string;
}

export function resumptionOpenKey(gameId: string): string {
  return `resumption_open:${gameId}`;
}

export interface ResumptionOpenStore {
  put(key: string, record: ResumptionOpenRecord): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string): Promise<ResumptionOpenRecord | null>;
}

/** In-memory stand-in for the Redis key. Tests and a process without Redis use this. */
export class InMemoryResumptionOpenStore implements ResumptionOpenStore {
  private readonly rows = new Map<string, ResumptionOpenRecord>();

  async put(key: string, record: ResumptionOpenRecord): Promise<void> {
    this.rows.set(key, record);
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  async read(key: string): Promise<ResumptionOpenRecord | null> {
    return this.rows.get(key) ?? null;
  }
}

export interface ResumptionCeilingDeps {
  store: ResumptionOpenStore;
  /** Closes the tracker's window. The tracker's `onResolved` releases parked events. */
  onFire: (gameId: string) => void;
  clock?: () => number;
}

/**
 * Wall-clock silence ceiling. The tracker does not own this timer.
 * Anchored on `revealingPlay.observedAt`, stored at `resumption_open:{gameId}`.
 */
export class ResumptionCeiling {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: ResumptionCeilingDeps) {}

  async onWindowOpened(gameId: string, window: ResumptionWindowOpened): Promise<void> {
    const openedAt = window.revealingPlay.observedAt;
    await this.deps.store.put(resumptionOpenKey(gameId), {
      openedAt,
      revealingPlayId: window.revealingPlay.play.playId,
    });
    this.arm(gameId, openedAt);
  }

  /** A play resolved the window first. Drop the timer and the key. */
  async onResolved(gameId: string): Promise<void> {
    this.clearTimer(gameId);
    await this.deps.store.delete(resumptionOpenKey(gameId));
  }

  /**
   * After a restart. Arms the remainder of the 4 minutes, or fires once if the deadline has passed.
   */
  async rearm(gameId: string): Promise<void> {
    const record = await this.deps.store.read(resumptionOpenKey(gameId));
    if (!record) return;
    const remaining = record.openedAt + RESUMPTION_CEILING_MS - this.now();
    if (remaining <= 0) {
      await this.fire(gameId);
      return;
    }
    this.arm(gameId, record.openedAt);
  }

  private arm(gameId: string, openedAt: number): void {
    this.clearTimer(gameId);
    const delay = Math.max(0, openedAt + RESUMPTION_CEILING_MS - this.now());
    const timer = setTimeout(() => {
      void this.fire(gameId);
    }, delay);
    timer.unref?.();
    this.timers.set(gameId, timer);
  }

  private async fire(gameId: string): Promise<void> {
    this.clearTimer(gameId);
    await this.deps.store.delete(resumptionOpenKey(gameId));
    this.deps.onFire(gameId);
  }

  private clearTimer(gameId: string): void {
    const timer = this.timers.get(gameId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(gameId);
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }
}
