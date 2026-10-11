import { describe, expect, it } from 'vitest';
import {
  RUNNER_HEARTBEAT_KEY,
  RUNNER_HEARTBEAT_MAX_AGE_MS,
  RUNNER_HEARTBEAT_TTL_SECONDS,
  publishRunnerHeartbeat,
  runnerHeartbeatFresh,
  type RunnerHeartbeatRedis,
} from './heartbeat.js';

const NOW = new Date('2026-10-11T17:00:00.000Z');

function recordingRedis(): { redis: RunnerHeartbeatRedis; writes: { key: string; value: string; ttl: number }[] } {
  const writes: { key: string; value: string; ttl: number }[] = [];
  return {
    writes,
    redis: {
      async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
        writes.push({ key, value, ttl: ttlSeconds });
      },
    },
  };
}

describe('publishRunnerHeartbeat', () => {
  it('does not write when this process is not leader', async () => {
    const { redis, writes } = recordingRedis();
    await publishRunnerHeartbeat(redis, { isLeader: false, inProgressFollows: 2, now: NOW });
    expect(writes).toEqual([]);
  });

  it('does not write when the leader is not following an in-progress game', async () => {
    const { redis, writes } = recordingRedis();
    await publishRunnerHeartbeat(redis, { isLeader: true, inProgressFollows: 0, now: NOW });
    expect(writes).toEqual([]);
  });

  it('writes an ISO timestamp with a 45s TTL while leader and following a live game', async () => {
    const { redis, writes } = recordingRedis();
    await publishRunnerHeartbeat(redis, { isLeader: true, inProgressFollows: 1, now: NOW });
    expect(writes).toEqual([
      {
        key: RUNNER_HEARTBEAT_KEY,
        value: '2026-10-11T17:00:00.000Z',
        ttl: RUNNER_HEARTBEAT_TTL_SECONDS,
      },
    ]);
  });
});

describe('runnerHeartbeatFresh', () => {
  const nowMs = NOW.getTime();

  it('is false when the key is missing', () => {
    expect(runnerHeartbeatFresh(null, nowMs)).toBe(false);
  });

  it('is false when the timestamp is older than 45s', () => {
    const stale = new Date(nowMs - RUNNER_HEARTBEAT_MAX_AGE_MS - 1).toISOString();
    expect(runnerHeartbeatFresh(stale, nowMs)).toBe(false);
  });

  it('is true at 45s and inside the window', () => {
    const edge = new Date(nowMs - RUNNER_HEARTBEAT_MAX_AGE_MS).toISOString();
    const fresh = new Date(nowMs - 1_000).toISOString();
    expect(runnerHeartbeatFresh(edge, nowMs)).toBe(true);
    expect(runnerHeartbeatFresh(fresh, nowMs)).toBe(true);
  });
});
