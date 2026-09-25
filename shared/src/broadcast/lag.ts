/**
 * Lag seconds for user-service ranking tiebreaks (B1.1).
 * Parallel to dispatcher BROADCAST_LAG_SECONDS but keyed by UserService.
 * youtube_tv / hulu_live are estimates (same ballpark as former hulu row).
 */
import type { UserService } from './types.js';

export const USER_SERVICE_LAG_SECONDS: Record<UserService, number> = {
  sunday_ticket: 75,
  youtube_tv: 45,
  hulu_live: 45,
  fubo: 50,
  directv: 40,
  sling: 50,
  amazon_prime: 40,
  peacock: 45,
  paramount_plus: 50,
  espn_plus: 60,
  nfl_plus: 60,
};

export const DEFAULT_USER_SERVICE_LAG_SECONDS = 60;

export function lagSecondsForUserService(service: UserService): number {
  return USER_SERVICE_LAG_SECONDS[service] ?? DEFAULT_USER_SERVICE_LAG_SECONDS;
}
