import { z } from 'zod';

/**
 * `users.preferences` jsonb shape (PLAN.md Section 7 — schema referenced here per sprint decision
 * #5; Section 7's column doc note points at this file rather than the migration). Section 8's
 * dispatcher (`shouldRateLimit`, `decideAction`) and Section 10's Settings screen are the only
 * readers/writers of this shape; both consume `Preferences`, never the raw jsonb.
 *
 * Every existing row's `preferences = '{}'::jsonb` (the users migration's default) parses to the
 * defaults below via `parsePreferences`, so this schema is additive over the current DB state.
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
});

export type Preferences = z.infer<typeof preferencesSchema>;

/** Parses a `users.preferences` jsonb value (or `undefined`/`{}`) into a fully-defaulted `Preferences`. */
export function parsePreferences(raw: unknown): Preferences {
  return preferencesSchema.parse(raw ?? {});
}
