import type { UserService } from '@pivot/shared/broadcast';

import { USER_SERVICE_OPTIONS } from './streamingServices';

/** Mirrors `ALERT_DELAY_*` in `@pivot/shared` (pinned in `alertTiming.test.ts`). */
export const ALERT_DELAY_STEP_SECONDS = 5;
export const ALERT_DELAY_MAX_SECONDS = 90;

/** `preferences.alertTiming`. A service missing from `serviceDelaySeconds` is "Same as default". */
export interface AlertTiming {
  defaultDelaySeconds: number;
  serviceDelaySeconds: Partial<Record<UserService, number>>;
}

export const ALERT_TIMING_HINT =
  'If you usually land in a commercial, add a delay. If you land mid-drive, use On time.';

export const SAME_AS_DEFAULT_LABEL = 'Same as default';

/** "On time" or "+15s". */
export function formatAlertDelay(seconds: number): string {
  return seconds <= 0 ? 'On time' : `+${seconds}s`;
}

/** The default's stepper: On time … +90s. */
export function stepDefaultDelay(seconds: number, direction: 1 | -1): number {
  const next = seconds + direction * ALERT_DELAY_STEP_SECONDS;
  return Math.min(ALERT_DELAY_MAX_SECONDS, Math.max(0, next));
}

/**
 * A service's stepper: Same as default (`null`), then On time … +90s. One step down from On time
 * returns to Same as default.
 */
export function stepServiceDelay(seconds: number | null, direction: 1 | -1): number | null {
  if (seconds === null) return direction === 1 ? 0 : null;
  if (seconds === 0 && direction === -1) return null;
  return stepDefaultDelay(seconds, direction);
}

export function formatServiceDelay(seconds: number | null): string {
  return seconds === null ? SAME_AS_DEFAULT_LABEL : formatAlertDelay(seconds);
}

/** The user's subscribed services in picker order: the ones that get their own row. */
export function alertTimingServices(
  appPresence: readonly { service: UserService; has_subscription: boolean }[],
): UserService[] {
  const subscribed = new Set(
    appPresence.filter((row) => row.has_subscription).map((row) => row.service),
  );
  return USER_SERVICE_OPTIONS.filter((service) => subscribed.has(service));
}
