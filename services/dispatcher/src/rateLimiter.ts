import type { FlagEvent, FlagReasonType, Preferences } from '@pivot/shared';

/** Section 3 "Rate limiting" / Section 8 `shouldRateLimit`: max 3 per 60s sliding window. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 3;

/** Decision #8: key-hygiene expiry on `user_notifications:{userId}` — cosmetic, doesn't affect the
 * sliding-window count (that's bounded by the read-side `countRecentNotifications` range), just
 * prevents the ZSET from growing unbounded for long-running users. */
export const NOTIFICATIONS_KEY_TTL_SECONDS = 3600;

const HIGH_LEVERAGE_REASONS: ReadonlySet<FlagReasonType> = new Set([
  'red_zone',
  'star_player_active',
  'close_game',
]);

function isHighLeverage(event: FlagEvent): boolean {
  return event.newState.reasons.some((r) => HIGH_LEVERAGE_REASONS.has(r.type));
}

/**
 * `user_notifications:{user_id}` (PLAN.md Section 7) — sliding 60s window for rate limiting. Section
 * 8's pseudocode only shows the read side (`zcount`); decision #8 makes the write side (record +
 * expire) explicit, since without it the sliding window never fills and rate limiting is a no-op.
 */
export interface RateLimitStore {
  /** Count of notifications delivered to `userId` with `deliveredAt` in `[sinceMs, untilMs]`. */
  countRecentNotifications(userId: string, sinceMs: number, untilMs: number): Promise<number>;
  /** Record a delivered notification and refresh the key's expiry (decision #8). Called ONLY after a
   *  successful delivery — a rate-limited or dropped event must never count towards its own window. */
  recordNotification(userId: string, eventId: string, deliveredAtMs: number): Promise<void>;
}

/** Computes the local hour-of-day in `timezone` for `date`, normalized to `[0, 23]`. */
function hourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourPart = formatter.formatToParts(date).find((p) => p.type === 'hour')?.value ?? '0';
  // Some ICU implementations render midnight as "24" under hour12:false; normalize back to 0.
  return Number(hourPart) % 24;
}

/** Section 8 `isInQuietHours` — window may wrap midnight (e.g. 22 -> 8). */
export function isInQuietHours(prefs: Preferences, now: Date = new Date()): boolean {
  if (!prefs.quietHours.enabled) return false;
  const { startHour, endHour, timezone } = prefs.quietHours;
  if (startHour === endHour) return false; // degenerate zero-width window
  const hour = hourInTimezone(now, timezone);
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/**
 * Section 8 `shouldRateLimit`. Preferences' `notificationMode: 'off'` (sprint decision #5's
 * user-specified schema) isn't in Section 8's pseudocode — that only names `'high_leverage_only'` —
 * but since `off` is a valid `Preferences` value with no defined behavior in Section 8, suppressing
 * delivery is the only sensible reading, so it's folded into this same gate rather than left silently
 * unhandled.
 */
export async function shouldRateLimit(
  event: FlagEvent,
  prefs: Preferences,
  store: RateLimitStore,
  now: number,
): Promise<boolean> {
  const recentCount = await store.countRecentNotifications(event.userId, now - WINDOW_MS, now);
  if (recentCount >= MAX_PER_WINDOW) return true;

  if (isInQuietHours(prefs, new Date(now))) return true;

  if (prefs.notificationMode === 'off') return true;
  if (prefs.notificationMode === 'high_leverage_only' && !isHighLeverage(event)) return true;

  return false;
}

/** In-memory `RateLimitStore` for local dev and the standard test suite. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly notifications = new Map<string, { eventId: string; deliveredAtMs: number }[]>();

  async countRecentNotifications(
    userId: string,
    sinceMs: number,
    untilMs: number,
  ): Promise<number> {
    const entries = this.notifications.get(userId) ?? [];
    return entries.filter((e) => e.deliveredAtMs >= sinceMs && e.deliveredAtMs <= untilMs).length;
  }

  async recordNotification(userId: string, eventId: string, deliveredAtMs: number): Promise<void> {
    const entries = this.notifications.get(userId) ?? [];
    entries.push({ eventId, deliveredAtMs });
    this.notifications.set(userId, entries);
  }

  /** Test/inspection helper — not part of the interface. */
  entriesFor(userId: string): { eventId: string; deliveredAtMs: number }[] {
    return [...(this.notifications.get(userId) ?? [])];
  }
}
