/** Redis key the leader refreshes while it is following a live game. Value is an ISO timestamp. */
export const RUNNER_HEARTBEAT_KEY = 'runner_heartbeat';

/** `SET` expiry. A missed beat drops the key; `/flags/current` treats a missing key as not live. */
export const RUNNER_HEARTBEAT_TTL_SECONDS = 45;

/** How often the leader writes the key while it is following an in-progress game. */
export const RUNNER_HEARTBEAT_INTERVAL_MS = 15_000;

/** Same window as the TTL. A value older than this is stale even if the key is still present. */
export const RUNNER_HEARTBEAT_MAX_AGE_MS = 45_000;

export interface RunnerHeartbeatRedis {
  /** `SET key value EX ttlSeconds`. */
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Writes `runner_heartbeat` only while this process is leader and following at least one
 * in-progress game. Standby and a leader with nothing live leave the key alone so its TTL can lapse.
 */
export async function publishRunnerHeartbeat(
  redis: RunnerHeartbeatRedis,
  input: { isLeader: boolean; inProgressFollows: number; now: Date },
): Promise<void> {
  if (!input.isLeader || input.inProgressFollows < 1) return;
  await redis.setEx(
    RUNNER_HEARTBEAT_KEY,
    input.now.toISOString(),
    RUNNER_HEARTBEAT_TTL_SECONDS,
  );
}

/** True when the stored ISO timestamp is present and not older than {@link RUNNER_HEARTBEAT_MAX_AGE_MS}. */
export function runnerHeartbeatFresh(raw: string | null, nowMs: number): boolean {
  if (raw === null || raw.length === 0) return false;
  const written = Date.parse(raw);
  if (Number.isNaN(written)) return false;
  return nowMs - written <= RUNNER_HEARTBEAT_MAX_AGE_MS;
}
