/**
 * The one stream-lag table (PLAN.md Section 8, keyed by user service per
 * docs/B1-BROADCAST-DESIGN.md §1.6): ranking tiebreaks in `expandWatchOptions` and the
 * dispatcher's `lagSecondsFor` both read it. Section 8's values are pre-calibration.
 */
import type { UserService } from './types.js';

export const USER_SERVICE_LAG_SECONDS: Record<UserService, number> = {
  sunday_ticket: 75,
  youtube_tv: 75, // unmeasured: sunday_ticket's value
  hulu_live: 75, // unmeasured: sunday_ticket's value
  fubo: 75, // unmeasured: sunday_ticket's value
  directv: 75, // unmeasured: sunday_ticket's value
  sling: 75, // unmeasured: sunday_ticket's value
  amazon_prime: 40,
  peacock: 45,
  paramount_plus: 50,
  espn_plus: 60,
  nfl_plus: 60,
};

/** Section 8's `?? 60` fallback for an unresolved source or a key outside the table. */
export const DEFAULT_LAG_SECONDS = 60;

export function lagSecondsFor(service: string | null): number {
  if (service === null) return DEFAULT_LAG_SECONDS;
  return (USER_SERVICE_LAG_SECONDS as Partial<Record<string, number>>)[service] ?? DEFAULT_LAG_SECONDS;
}
