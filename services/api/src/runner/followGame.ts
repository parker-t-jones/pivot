import type { PlayEvent } from '@pivot/engine';
import { EspnPlaySource, summaryPlayIds, type EspnClient } from '@pivot/ingestion';
import type { SeenPlaySet } from './seenPlays.js';

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
 * A later play id is written to that set before `onPlayEvent`.
 */
export async function followGame(deps: FollowGameDeps): Promise<void> {
  const seeded = await deps.getSummary(deps.eventId);
  if (!seeded.ok || deps.signal.aborted) return;

  for (const playId of summaryPlayIds(seeded.data)) {
    await deps.seen.add(deps.eventId, playId);
  }
  if (deps.signal.aborted) return;

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

async function deliverIfNew(deps: FollowGameDeps, play: PlayEvent): Promise<void> {
  if (await deps.seen.has(deps.eventId, play.playId)) return;
  await deps.seen.add(deps.eventId, play.playId);
  await deps.onPlayEvent(play);
}
