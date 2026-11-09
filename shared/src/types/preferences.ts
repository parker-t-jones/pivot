import { z } from 'zod';
import { USER_SERVICES } from '../broadcast/types.js';

/** Alert timing stepper (issue #8): On time (0) to +90s, in 5s steps. Delays only. */
export const ALERT_DELAY_MAX_SECONDS = 90;
export const ALERT_DELAY_STEP_SECONDS = 5;

export const alertDelaySecondsSchema = z
  .number()
  .int()
  .min(0)
  .max(ALERT_DELAY_MAX_SECONDS)
  .multipleOf(ALERT_DELAY_STEP_SECONDS);

/**
 * How long to hold a user's alerts. `defaultDelaySeconds` covers every service; a key in
 * `serviceDelaySeconds` overrides it for alerts that route to that service. A missing key is
 * "Same as default".
 */
export const alertTimingSchema = z.object({
  defaultDelaySeconds: alertDelaySecondsSchema.default(0),
  serviceDelaySeconds: z.partialRecord(z.enum(USER_SERVICES), alertDelaySecondsSchema).default({}),
});

export type AlertTiming = z.infer<typeof alertTimingSchema>;

export const DEFAULT_ALERT_TIMING: AlertTiming = {
  defaultDelaySeconds: 0,
  serviceDelaySeconds: {},
};

/**
 * Onboarding "What are you following?" (issue #31 / PIVOT-STAKES-PLAN.md §12.1, no prediction
 * markets option — not built). Multi-select; at least one is required to leave that step, but the
 * key itself defaults to empty so an existing row (or a row from a skipped step) still parses.
 */
export const FOLLOWING_OPTIONS = ['fantasy', 'bets', 'survivor'] as const;
export type FollowingOption = (typeof FOLLOWING_OPTIONS)[number];

/**
 * `users.preferences` jsonb shape (PLAN.md Section 7).
 *
 * `watchedLeagueIds` — leagues the engine + Home stake from. Free: at most one.
 * Pro: any subset (client "Select all" writes the full list).
 */
export const preferencesSchema = z.object({
  notificationMode: z.enum(['all', 'high_leverage_only', 'off']).default('all'),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      startHour: z.number().int().min(0).max(23).default(22),
      endHour: z.number().int().min(0).max(23).default(8),
      timezone: z.string().default('America/New_York'),
    })
    .default({ enabled: false, startHour: 22, endHour: 8, timezone: 'America/New_York' }),
  autoSwitch: z.boolean().default(false),
  /** Opponent red-zone nudges on Home. Off until the client turns them on. */
  watchOpponent: z.boolean().default(false),
  watchedLeagueIds: z.array(z.string().uuid()).default([]),
  alertTiming: alertTimingSchema.default(DEFAULT_ALERT_TIMING),
  /** It only orders add-paths and filter pills; it never gates a feature. */
  following: z.array(z.enum(FOLLOWING_OPTIONS)).default([]),
});

export type Preferences = z.infer<typeof preferencesSchema>;

/** Parses a `users.preferences` jsonb value (or `undefined`/`{}`) into a fully-defaulted `Preferences`. */
export function parsePreferences(raw: unknown): Preferences {
  return preferencesSchema.parse(raw ?? {});
}

/**
 * Seconds to hold one alert for a user whose alert routes to `service` (the destination the
 * dispatcher resolves; `null` when none resolves). The service's override wins; otherwise the
 * default. Never negative: nothing makes an alert earlier than detection.
 */
export function alertDelaySecondsFor(timing: AlertTiming, service: string | null): number {
  const override =
    service === null
      ? undefined
      : (timing.serviceDelaySeconds as Partial<Record<string, number>>)[service];
  return Math.max(0, override ?? timing.defaultDelaySeconds);
}

/** True when no setting can add a delay, so callers can skip resolving the destination. */
export function alertTimingIsOnTime(timing: AlertTiming): boolean {
  return (
    timing.defaultDelaySeconds === 0 &&
    Object.values(timing.serviceDelaySeconds).every((seconds) => seconds === 0)
  );
}

/** Free-tier entitlement caps (PLAN.md Active Lineup + Pro). */
export const FREE_MAX_LEAGUES = 3;
export const FREE_MAX_WATCHED_LEAGUES = 1;
export const FREE_MAX_MANUAL_LINEUP_SLOTS = 9;
