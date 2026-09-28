/**
 * `user_app_presence.service` catalog (docs/B1-BROADCAST-DESIGN.md §1.4) plus the display metadata
 * Settings' "Streaming services" section, onboarding step 4, and the Section 10 deep-link error
 * state's alternate-broadcast picker need. Keyed by shared `UserService` (type-only import), so a
 * key missing here or not in the catalog is a compile error. Networks are not picker values.
 */
import type { UserService } from '@pivot/shared/broadcast';

export interface UserServiceInfo {
  service: UserService;
  label: string;
  /**
   * App Store *search* link, not a direct `id`-based link — a wrong hardcoded numeric app id would
   * be worse than a search results page (silently 404s or opens the wrong app), and this doesn't
   * require verifying the catalog's real App Store ids by hand. Good enough for the Section 10 "Get app"
   * fallback; a real app deserves direct ids verified against the App Store, which is out of scope
   * for this pass (see report).
   */
  appStoreUrl: string;
}

function searchUrl(appName: string): string {
  return `https://apps.apple.com/us/search?term=${encodeURIComponent(appName)}`;
}

/** Picker order is this object's key order (§1.4). */
export const USER_SERVICE_INFO: Record<UserService, UserServiceInfo> = {
  youtube_tv: { service: 'youtube_tv', label: 'YouTube TV', appStoreUrl: searchUrl('YouTube TV') },
  sunday_ticket: {
    service: 'sunday_ticket',
    label: 'NFL Sunday Ticket',
    appStoreUrl: searchUrl('NFL Sunday Ticket'),
  },
  hulu_live: { service: 'hulu_live', label: 'Hulu + Live TV', appStoreUrl: searchUrl('Hulu') },
  fubo: { service: 'fubo', label: 'Fubo', appStoreUrl: searchUrl('Fubo') },
  directv: { service: 'directv', label: 'DIRECTV', appStoreUrl: searchUrl('DIRECTV') },
  sling: { service: 'sling', label: 'Sling TV', appStoreUrl: searchUrl('Sling TV') },
  amazon_prime: {
    service: 'amazon_prime',
    label: 'Prime Video',
    appStoreUrl: searchUrl('Amazon Prime Video'),
  },
  peacock: { service: 'peacock', label: 'Peacock', appStoreUrl: searchUrl('Peacock TV') },
  paramount_plus: {
    service: 'paramount_plus',
    label: 'Paramount+',
    appStoreUrl: searchUrl('Paramount+'),
  },
  espn_plus: { service: 'espn_plus', label: 'ESPN+', appStoreUrl: searchUrl('ESPN') },
  nfl_plus: { service: 'nfl_plus', label: 'NFL+', appStoreUrl: searchUrl('NFL') },
};

export const USER_SERVICE_OPTIONS = Object.keys(USER_SERVICE_INFO) as UserService[];

export function userServiceLabel(service: string): string {
  return USER_SERVICE_INFO[service as UserService]?.label ?? service;
}

export function userServiceAppStoreUrl(service: string): string | null {
  return USER_SERVICE_INFO[service as UserService]?.appStoreUrl ?? null;
}

/** Settings' one-line nudge (§2.2): YouTube TV on, Sunday Ticket off. Copy only, no stored flag. */
export function showsSundayTicketHint(presence: ReadonlyMap<string, boolean>): boolean {
  return presence.get('youtube_tv') === true && presence.get('sunday_ticket') !== true;
}
