/** Redis key the leader holds. Value is `{owner}:{epoch}`. */
export const LEADER_KEY = 'pivot:runner:leader';

/** `INCR` this, then `SET` the leader key `NX EX`. A failed acquire still consumes an epoch. */
export const LEADER_EPOCH_KEY = 'pivot:runner:leader:epoch';

/** `SET` expiry. One missed renew does not drop the lock; three do. */
export const LEADER_TTL_SECONDS = 15;

/** How often the holder refreshes the key with `XX EX`, and how long a standby waits. */
export const LEADER_TICK_MS = 5_000;

/**
 * Commands the lock uses. Tests pass a fake. A real TCP client is not part of this slice.
 * Renew is not a bare `SET XX`: it has to leave the key alone when the value is no longer ours.
 */
export interface LeaderLockRedis {
  incr(key: string): Promise<number>;
  /** `SET key value NX EX ttlSeconds`. True when this call created the key. */
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /**
   * `SET key value XX EX ttlSeconds` only when the current value equals `expected`.
   * False when the key is missing or holds someone else's value.
   */
  setXxExIfMatch(
    key: string,
    expected: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  get(key: string): Promise<string | null>;
}

/** `FLY_MACHINE_ID` when Fly set it, otherwise `hostname:pid`. */
export function leaderOwner(machineId: string | undefined, hostname: string, pid: number): string {
  if (machineId !== undefined && machineId.length > 0) return machineId;
  return `${hostname}:${pid}`;
}

export function leaderValue(owner: string, epoch: number): string {
  return `${owner}:${epoch}`;
}

/** `INCR` the epoch, then `SET NX EX`. Null when another process already holds the key. */
export async function tryAcquireLeader(
  redis: LeaderLockRedis,
  owner: string,
): Promise<string | null> {
  const epoch = await redis.incr(LEADER_EPOCH_KEY);
  const value = leaderValue(owner, epoch);
  const acquired = await redis.setNxEx(LEADER_KEY, value, LEADER_TTL_SECONDS);
  return acquired ? value : null;
}

/** Refresh our lock. False means this process has lost it. */
export async function renewLeader(redis: LeaderLockRedis, value: string): Promise<boolean> {
  return redis.setXxExIfMatch(LEADER_KEY, value, value, LEADER_TTL_SECONDS);
}
