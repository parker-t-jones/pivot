import type { PlayEvent } from '@pivot/engine';
import {
  EspnPlaySource,
  summaryPlayIds,
  type EspnClient,
  type EspnSummary,
} from '@pivot/ingestion';
import type { SeenPlaySet } from './seenPlays.js';

/** Same curve as an ESPN poll failure: 10s, 20s, 40s, then 60s. */
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

function backoffMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** consecutiveFailures);
}

export interface FollowGameDeps {
  eventId: string;
  getSummary: EspnClient['getSummary'];
  seen: SeenPlaySet;
  onPlayEvent: (play: PlayEvent) => Promise<void>;
  /** Aborted when this process loses the lock. The source is disconnected. */
  signal: AbortSignal;
  pollIntervalMs?: number;
}

/**
 * One live game after the lock is acquired.
 * The summary fetched here is recorded into `espn_seen_plays` and is not passed to `onPlayEvent`.
 * Polling starts only after that seed succeeds. A later play id is written to the seen set only
 * after `onPlayEvent` resolves.
 */
export async function followGame(deps: FollowGameDeps): Promise<void> {
  const seeded = await loadSeed(deps);
  if (seeded === null || deps.signal.aborted) return;

  for (const playId of summaryPlayIds(seeded)) {
    await deps.seen.add(deps.eventId, playId);
  }
  if (deps.signal.aborted || summaryIsFinal(seeded)) return;

  const source = new EspnPlaySource({
    eventId: deps.eventId,
    client: { getSummary: deps.getSummary },
    initialSeenPlayIds: await deps.seen.members(deps.eventId),
    ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
  });

  const disconnect = (): void => {
    void source.disconnect();
  };
  deps.signal.addEventListener('abort', disconnect, { once: true });
  try {
    await source.subscribe((play) => deliverIfNew(deps, play));
  } finally {
    deps.signal.removeEventListener('abort', disconnect);
  }
}

/**
 * Retries a not-ok or thrown seed fetch. Returns the summary to record, or null when the lock
 * is lost. A final summary is returned so its ids are recorded, and the caller does not poll.
 */
async function loadSeed(deps: FollowGameDeps): Promise<EspnSummary | null> {
  let attempt = 0;
  while (!deps.signal.aborted) {
    try {
      const result = await deps.getSummary(deps.eventId);
      if (result.ok) return result.data;
      attempt += 1;
      logSeedFailure(deps.eventId, attempt, result.reason);
    } catch (error) {
      attempt += 1;
      logSeedFailure(deps.eventId, attempt, failureReason(error));
    }
    if (deps.signal.aborted) return null;
    await delay(backoffMs(attempt), deps.signal);
  }
  return null;
}

function logSeedFailure(eventId: string, attempt: number, reason: string): void {
  console.log(`[runner] seed failed ${eventId} attempt ${attempt}: ${reason}`);
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summaryIsFinal(summary: EspnSummary): boolean {
  const statusType = summary.header?.competitions?.[0]?.status?.type;
  return Boolean(statusType?.completed) || statusType?.state === 'post';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

async function deliverIfNew(deps: FollowGameDeps, play: PlayEvent): Promise<void> {
  if (await deps.seen.has(deps.eventId, play.playId)) return;
  try {
    await deps.onPlayEvent(play);
  } catch (error) {
    console.error(`[runner] play failed ${deps.eventId} ${play.playId}: ${failureReason(error)}`);
    return;
  }
  await deps.seen.add(deps.eventId, play.playId);
}
