import { defaultClock, type Clock } from '@pivot/engine';
import {
  ALERT_DELAY_MAX_SECONDS,
  alertDelaySecondsFor,
  alertTimingIsOnTime,
  type FlagEvent,
} from '@pivot/shared';
import { resolveLikelyBroadcastSource, type BroadcastCatalog } from './broadcastLag.js';
import type { UserDirectory } from './catalogs.js';

/**
 * How long a resolved delay is reused for the same user and game. Keeps a play that fires for many
 * users from paying the user + airings lookups again on every later play. A Settings change reaches
 * alerts within this long.
 */
export const ALERT_DELAY_CACHE_TTL_MS = 30_000;

export interface AlertDelayDeps {
  users: Pick<UserDirectory, 'getUser'>;
  broadcasts: BroadcastCatalog;
  clock?: Clock;
  cacheTtlMs?: number;
}

/**
 * `delay(user, destinationService)` from issue #8, as the gate's `fireDelayMs`. The destination is
 * the service delivery names in the push (`resolveLikelyBroadcastSource(...).source.service`), so
 * the delay matches the "Watch on {service}" link. No resolvable service falls back to the user's
 * default. A failed lookup returns 0: a settings read must never hold or drop an alert.
 */
export function createAlertDelay(deps: AlertDelayDeps): (event: FlagEvent) => Promise<number> {
  const clock = deps.clock ?? defaultClock;
  const ttlMs = deps.cacheTtlMs ?? ALERT_DELAY_CACHE_TTL_MS;
  const cache = new Map<string, { delayMs: number; expiresAt: number }>();

  return async (event) => {
    const key = `${event.userId}:${event.gameId}`;
    const now = clock();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.delayMs;

    try {
      const user = await deps.users.getUser(event.userId);
      let seconds = 0;
      if (user && !alertTimingIsOnTime(user.preferences.alertTiming)) {
        const likely = await resolveLikelyBroadcastSource(
          event.gameId,
          event.userId,
          deps.broadcasts,
        );
        seconds = alertDelaySecondsFor(
          user.preferences.alertTiming,
          likely.source?.service ?? null,
        );
      }
      const delayMs = Math.min(Math.max(0, seconds), ALERT_DELAY_MAX_SECONDS) * 1000;
      cache.set(key, { delayMs, expiresAt: now + ttlMs });
      if (cache.size > 10_000) pruneExpired(cache, now);
      return delayMs;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'lookup failed';
      console.warn(
        `[alert-delay] lookup failed user=${event.userId} game=${event.gameId}: ${reason}`,
      );
      return 0;
    }
  };
}

function pruneExpired(cache: Map<string, { expiresAt: number }>, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}
