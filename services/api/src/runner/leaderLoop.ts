import {
  LEADER_TICK_MS,
  renewLeader,
  tryAcquireLeader,
  type LeaderLockRedis,
} from './leaderLock.js';

export interface LeaderHold {
  value: string;
}

export interface LeaderLoopDeps {
  redis: LeaderLockRedis;
  /** `FLY_MACHINE_ID`, or `hostname:pid` when that variable is unset. */
  owner: string;
  /**
   * Runs only while this process holds the lock. The poll lives in here.
   * When `signal` aborts, the lock has been lost or the loop was stopped: disconnect and return.
   */
  lead: (hold: LeaderHold, signal: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
}

export interface LeaderLoopHandle {
  stop: () => void;
  done: Promise<void>;
}

/**
 * One process's acquire / renew / standby cycle.
 * A failed `SET NX` logs one standby line and does not call `lead`.
 * A failed renew aborts `lead` so the poll loop stops, then this process waits and tries again.
 */
export function startLeaderLoop(deps: LeaderLoopDeps): LeaderLoopHandle {
  let stopped = false;
  let abort: AbortController | undefined;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  let standbyTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeStandby: (() => void) | undefined;
  let wakeHold: (() => void) | undefined;

  const stop = (): void => {
    stopped = true;
    abort?.abort();
    if (renewTimer !== undefined) clearInterval(renewTimer);
    wakeStandby?.();
    wakeHold?.();
  };

  const sleepStandby = (): Promise<void> =>
    new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      wakeStandby = () => {
        wakeStandby = undefined;
        if (standbyTimer !== undefined) clearTimeout(standbyTimer);
        standbyTimer = undefined;
        resolve();
      };
      standbyTimer = setTimeout(wakeStandby, LEADER_TICK_MS);
      standbyTimer.unref?.();
    });

  const waitUntilLost = (value: string): Promise<boolean> =>
    new Promise((resolve) => {
      const finish = (lost: boolean): void => {
        wakeHold = undefined;
        if (renewTimer !== undefined) clearInterval(renewTimer);
        renewTimer = undefined;
        resolve(lost);
      };
      wakeHold = () => finish(false);
      renewTimer = setInterval(() => {
        void renewLeader(deps.redis, value).then((stillHeld) => {
          if (!stillHeld) finish(true);
        });
      }, LEADER_TICK_MS);
      renewTimer.unref?.();
    });

  const done = (async () => {
    while (!stopped) {
      const value = await tryAcquireLeader(deps.redis, deps.owner);
      if (stopped) return;
      if (value === null) {
        (deps.log ?? console.log)('[runner] standby');
        await sleepStandby();
        continue;
      }

      const controller = new AbortController();
      abort = controller;
      renewTimer = setInterval(() => {
        void renewLeader(deps.redis, value).then((stillHeld) => {
          if (!stillHeld) controller.abort();
        });
      }, LEADER_TICK_MS);
      renewTimer.unref?.();

      try {
        await deps.lead({ value }, controller.signal);
      } finally {
        clearInterval(renewTimer);
        renewTimer = undefined;
        abort = undefined;
      }

      if (stopped) return;
      // `lead` finished while the key is still ours (the game ended). Do not `SET NX` against
      // our own lock, and do not poll again. Wait until renew fails, then stand by.
      if (!controller.signal.aborted) {
        const lost = await waitUntilLost(value);
        if (stopped || !lost) return;
      }
      await sleepStandby();
    }
  })();

  return { stop, done };
}
