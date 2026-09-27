import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEADER_KEY, leaderOwner, type LeaderLockRedis } from './leaderLock.js';
import { startLeaderLoop, type LeaderHold } from './leaderLoop.js';

/** In-memory `SET NX` / `SET XX` / `INCR`. Expired keys are absent. */
class FakeLeaderRedis implements LeaderLockRedis {
  readonly nxResults: boolean[] = [];
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.expire(key);
    if (this.values.has(key)) {
      this.nxResults.push(false);
      return false;
    }
    this.values.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    this.nxResults.push(true);
    return true;
  }

  async setXxExIfMatch(
    key: string,
    expected: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    this.expire(key);
    const current = this.values.get(key);
    if (current === undefined || current.value !== expected) return false;
    this.values.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }

  async get(key: string): Promise<string | null> {
    this.expire(key);
    return this.values.get(key)?.value ?? null;
  }

  /** Another process now holds the key, with its own expiry. */
  steal(key: string, value: string, ttlSeconds = 120): void {
    this.values.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  private expire(key: string): void {
    const current = this.values.get(key);
    if (current !== undefined && current.expiresAt <= this.now()) this.values.delete(key);
  }
}

function untilAbort(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      resolve();
    }
  });
}

describe('leader lock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails the second SET NX and the standby does not poll', async () => {
    vi.useFakeTimers();
    const redis = new FakeLeaderRedis(() => Date.now());
    const polls: string[] = [];
    const logs: string[] = [];

    const leader = startLeaderLoop({
      redis,
      owner: 'leader-a',
      log: (line) => logs.push(line),
      lead: async (_hold, signal) => {
        polls.push('leader');
        await untilAbort(signal, 60_000);
      },
    });
    const standby = startLeaderLoop({
      redis,
      owner: 'leader-b',
      log: (line) => logs.push(line),
      lead: async () => {
        polls.push('standby');
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(redis.nxResults[0]).toBe(true);
    expect(redis.nxResults[1]).toBe(false);
    expect(await redis.get(LEADER_KEY)).toBe('leader-a:1');
    expect(polls).toEqual(['leader']);
    expect(logs).toEqual(['[runner] standby']);
    expect(leaderOwner('machine-a', 'box', 42)).toBe('machine-a');
    expect(leaderOwner(undefined, 'box', 42)).toBe('box:42');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(polls).toEqual(['leader']);
    expect(logs).toEqual(['[runner] standby', '[runner] standby']);

    leader.stop();
    standby.stop();
    await leader.done;
    await standby.done;
  });

  it('stops the poll loop when the lock is lost', async () => {
    vi.useFakeTimers();
    const redis = new FakeLeaderRedis(() => Date.now());
    const polls: number[] = [];

    const logs: string[] = [];
    const loop = startLeaderLoop({
      redis,
      owner: 'leader-a',
      log: (line) => logs.push(line),
      lead: async (hold: LeaderHold, signal: AbortSignal) => {
        while (!signal.aborted) {
          if ((await redis.get(LEADER_KEY)) !== hold.value) return;
          polls.push(Date.now());
          await untilAbort(signal, 5_000);
        }
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toEqual([Date.now()]);

    redis.steal(LEADER_KEY, 'leader-b:2');
    await vi.advanceTimersByTimeAsync(5_000);
    const stoppedAt = polls.length;
    expect(stoppedAt).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls).toHaveLength(1);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => line === '[runner] standby')).toBe(true);

    loop.stop();
    await loop.done;
  });

  it('does not poll again when lead returns while this process still holds the lock', async () => {
    vi.useFakeTimers();
    const redis = new FakeLeaderRedis(() => Date.now());
    const polls: string[] = [];
    const logs: string[] = [];
    const loop = startLeaderLoop({
      redis,
      owner: 'leader-a',
      log: (line) => logs.push(line),
      lead: async () => {
        polls.push('once');
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(polls).toEqual(['once']);
    expect(logs).toEqual([]);
    expect(await redis.get(LEADER_KEY)).toBe('leader-a:1');

    loop.stop();
    await loop.done;
  });
});
