import type { DeliveryDeps } from './delivery.js';
import type { PendingPushRetry } from './catalogs.js';

/** Wait between a failed send and the next attempt. */
export const PUSH_RETRY_BACKOFF_MS = 5_000;

/** A reveal older than this is no longer retried. */
export const PUSH_RELEVANCE_MS = 2 * 60 * 1000;

/**
 * Sends pushes that failed after their `flag_events` row was inserted. A reveal that is already
 * two minutes old is dropped and logged. A success here is the one delivery; the row is not inserted
 * again.
 */
export async function retryPendingPushes(deps: DeliveryDeps, now: number): Promise<void> {
  const due = await deps.persistence.duePushRetries(now);
  for (const item of due) {
    if (now - item.deliveredAt >= PUSH_RELEVANCE_MS) {
      await deps.persistence.recordPushOutcome({ id: item.id, status: 'dropped' });
      console.log(`[push] retry dropped ${item.userId} ${item.id}: reveal older than 2m`);
      continue;
    }
    await attemptPush(deps, item, now);
  }
}

async function attemptPush(deps: DeliveryDeps, item: PendingPushRetry, now: number): Promise<void> {
  try {
    const result = await deps.pushNotifier.sendPush(item.payload);
    if (result.success) {
      await deps.persistence.recordPushOutcome({ id: item.id, status: 'sent' });
      return;
    }
    await markPending(deps, item, now, result.error ?? 'push failed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPending(deps, item, now, message);
  }
}

async function markPending(
  deps: DeliveryDeps,
  item: PendingPushRetry,
  now: number,
  lastError: string,
): Promise<void> {
  await deps.persistence.recordPushOutcome({
    id: item.id,
    status: 'pending',
    userId: item.userId,
    deliveredAt: item.deliveredAt,
    attempts: item.attempts + 1,
    lastError,
    nextAttemptAt: now + PUSH_RETRY_BACKOFF_MS,
    payload: item.payload,
  });
}
