/**
 * `game_broadcasts.service` / `user_app_presence.service` enum (Section 7), plus the display
 * metadata Settings' "Streaming services" section, onboarding step 4, and the Section 10 deep-link
 * error state's alternate-broadcast picker all need. Mirrors `me.ts`'s server-side
 * `STREAMING_SERVICES` constant and `gameDisplay.ts`'s `SERVICE_LABELS` by hand — same
 * no-shared-wire-types-package tradeoff documented in `flagEventPayload.ts`.
 */
export const STREAMING_SERVICES = [
  'sunday_ticket',
  'espn_plus',
  'paramount_plus',
  'peacock',
  'amazon_prime',
  'nfl_plus',
  'nfl_network',
  'hulu',
  'fubo',
  'directv',
  'fox',
  'cbs',
  'nbc',
  'abc',
] as const;

export type StreamingService = (typeof STREAMING_SERVICES)[number];

export interface StreamingServiceInfo {
  service: StreamingService;
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

export const STREAMING_SERVICE_INFO: Record<StreamingService, StreamingServiceInfo> = {
  sunday_ticket: {
    service: 'sunday_ticket',
    label: 'YouTube TV',
    appStoreUrl: searchUrl('YouTube TV'),
  },
  espn_plus: { service: 'espn_plus', label: 'ESPN+', appStoreUrl: searchUrl('ESPN') },
  paramount_plus: {
    service: 'paramount_plus',
    label: 'Paramount+',
    appStoreUrl: searchUrl('Paramount+'),
  },
  peacock: { service: 'peacock', label: 'Peacock', appStoreUrl: searchUrl('Peacock TV') },
  amazon_prime: {
    service: 'amazon_prime',
    label: 'Prime Video',
    appStoreUrl: searchUrl('Amazon Prime Video'),
  },
  nfl_plus: { service: 'nfl_plus', label: 'NFL+', appStoreUrl: searchUrl('NFL') },
  nfl_network: { service: 'nfl_network', label: 'NFL Network', appStoreUrl: searchUrl('NFL') },
  hulu: { service: 'hulu', label: 'Hulu', appStoreUrl: searchUrl('Hulu') },
  fubo: { service: 'fubo', label: 'Fubo', appStoreUrl: searchUrl('Fubo') },
  directv: { service: 'directv', label: 'DIRECTV', appStoreUrl: searchUrl('DIRECTV') },
  fox: { service: 'fox', label: 'FOX', appStoreUrl: searchUrl('FOX Sports') },
  cbs: { service: 'cbs', label: 'CBS', appStoreUrl: searchUrl('Paramount+') },
  nbc: { service: 'nbc', label: 'NBC', appStoreUrl: searchUrl('Peacock TV') },
  abc: { service: 'abc', label: 'ABC', appStoreUrl: searchUrl('ABC') },
};

export function streamingServiceLabel(service: string): string {
  return STREAMING_SERVICE_INFO[service as StreamingService]?.label ?? service;
}

export function streamingServiceAppStoreUrl(service: string): string | null {
  return STREAMING_SERVICE_INFO[service as StreamingService]?.appStoreUrl ?? null;
}
