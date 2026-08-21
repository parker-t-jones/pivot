import { defaultClock, type Clock } from '@roster-remote/engine';
import type { DeliveryDeps } from './delivery.js';
import { deliverFlagEvent } from './delivery.js';
import { isStillRelevant } from './isStillRelevant.js';
import type { FlagEventQueue } from './queue.js';
import type { GameStateStore } from './providers/gameStateStore.js';
import { shouldRateLimit, type RateLimitStore } from './rateLimiter.js';
import type { UserDirectory } from './catalogs.js';

const DEFAULT_BATCH_SIZE = 100; // Section 8 `zrangebyscore('flag_event_queue', 0, now, { limit: 100 })`
const POLL_INTERVAL_MS = 500; // Section 8 `flagEventDispatcher`'s `sleep(500)`

export interface DispatcherTickDeps {
  queue: FlagEventQueue;
  gameStateStore: GameStateStore;
  userDirectory: UserDirectory;
  rateLimitStore: RateLimitStore;
  delivery: DeliveryDeps;
  clock?: Clock;
  batchSize?: number;
}

export interface DispatcherTickResult {
  processed: number;
  delivered: number;
  droppedStale: number;
  droppedMissingUser: number;
  droppedRateLimited: number;
}

function emptyResult(): DispatcherTickResult {
  return {
    processed: 0,
    delivered: 0,
    droppedStale: 0,
    droppedMissingUser: 0,
    droppedRateLimited: 0,
  };
}

/**
 * One iteration of the Section 8 `flagEventDispatcher` loop body — pop due events, re-validate
 * (Sprint 4 closeout item #1's two independent gates), rate-limit, deliver, dequeue. Extracted from
 * the infinite polling loop (`startDispatcherLoop`) so it's directly testable without depending on
 * real sleeps (mirrors the existing `runWorkerCycle`/`worker.ts` split for the lineup-sync worker).
 *
 * Processes due events sequentially (matching Section 8's plain `for` loop, not `Promise.all`) so
 * that a burst of events for the same user hits the rate limiter's read-then-write cycle in order.
 */
export async function runDispatcherTick(deps: DispatcherTickDeps): Promise<DispatcherTickResult> {
  const clock = deps.clock ?? defaultClock;
  const now = clock();
  const due = await deps.queue.due(now, deps.batchSize ?? DEFAULT_BATCH_SIZE);

  const result = emptyResult();

  for (const item of due) {
    result.processed += 1;
    const { event } = item;

    const [currentState, userIsActive] = await Promise.all([
      deps.gameStateStore.getUserFlagState(event.userId, event.gameId),
      deps.gameStateStore.isUserActive(event.userId),
    ]);

    if (!isStillRelevant(event, currentState, userIsActive)) {
      await deps.queue.remove(item);
      result.droppedStale += 1;
      continue;
    }

    const user = await deps.userDirectory.getUser(event.userId);
    if (!user) {
      await deps.queue.remove(item);
      result.droppedMissingUser += 1;
      continue;
    }

    if (await shouldRateLimit(event, user.preferences, deps.rateLimitStore, now)) {
      await deps.queue.remove(item);
      result.droppedRateLimited += 1;
      continue;
    }

    await deliverFlagEvent(deps.delivery, event, user);
    await deps.queue.remove(item);
    result.delivered += 1;
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DispatcherLoopOptions {
  signal?: AbortSignal;
  onTick?: (result: DispatcherTickResult) => void;
  pollIntervalMs?: number;
}

/**
 * Section 8 `flagEventDispatcher`'s `while (true) { ...; await sleep(500); }`. Deliberately thin —
 * all the logic under test lives in `runDispatcherTick`. Runs until `options.signal` is aborted.
 */
export async function startDispatcherLoop(
  deps: DispatcherTickDeps,
  options: DispatcherLoopOptions = {},
): Promise<void> {
  while (!options.signal?.aborted) {
    const result = await runDispatcherTick(deps);
    options.onTick?.(result);
    await sleep(options.pollIntervalMs ?? POLL_INTERVAL_MS);
  }
}
