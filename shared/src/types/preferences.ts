import { z } from 'zod';

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
  watchedLeagueIds: z.array(z.string().uuid()).default([]),
});

export type Preferences = z.infer<typeof preferencesSchema>;

/** Parses a `users.preferences` jsonb value (or `undefined`/`{}`) into a fully-defaulted `Preferences`. */
export function parsePreferences(raw: unknown): Preferences {
  return preferencesSchema.parse(raw ?? {});
}

/** Free-tier entitlement caps (PLAN.md Active Lineup + Pro). */
export const FREE_MAX_LEAGUES = 3;
export const FREE_MAX_WATCHED_LEAGUES = 1;
export const FREE_MAX_MANUAL_LINEUP_SLOTS = 9;
