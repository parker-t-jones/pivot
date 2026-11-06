import { USER_SERVICE_LANDING_URLS } from './serviceLandingUrls.js';
import type { AiringNetwork, UserService } from './types.js';

/** Device-tested YouTube TV / Sunday Ticket search. Never a `/nflst/` path. */
const YOUTUBE_TV_SEARCH = 'https://tv.youtube.com/search/';

/** Prime Video app home. Used when a game has no `prime_event_gti` row. */
const PRIME_APP_HOME_URL = 'https://app.primevideo.com/';

/** `amzn1.dv.gti.` plus 36 hex/dash characters. Same check as the table. */
const PRIME_GTI_PATTERN = /^amzn1\.dv\.gti\.[0-9a-f-]{36}$/;

function primeDetailUrl(gti: string | null | undefined): string | null {
  if (gti == null) return null;
  const trimmed = gti.trim();
  if (!PRIME_GTI_PATTERN.test(trimmed)) return null;
  return `https://app.primevideo.com/detail?gti=${trimmed}`;
}

/**
 * Prime Video in a browser. `app.primevideo.com` redirects to the get-the-app splash.
 * Web notifications and the web Switch open the storefront instead.
 */
export const PRIME_VIDEO_WEB_STOREFRONT = 'https://www.primevideo.com/storefront';

/** Prime app and splash URLs become the storefront. Every other https URL is unchanged. */
export function browserPrimeWatchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:') return url;
  if (parsed.hostname === 'app.primevideo.com') return PRIME_VIDEO_WEB_STOREFRONT;
  if (parsed.hostname === 'www.primevideo.com' && parsed.pathname.startsWith('/splash/')) {
    return PRIME_VIDEO_WEB_STOREFRONT;
  }
  return url;
}

/** DirecTV Stream search. Query is "{Away} vs {Home}", without the "today" suffix. */
const DIRECTV_SEARCH = 'https://stream.directv.com/search?q=';

export function isThursdayEt(kickoff: Date): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(kickoff);
  return weekday === 'Thursday';
}

/** "{Away nickname} vs {Home nickname} today". The same phrase for every network. */
export function matchupSearchQuery(awayNickname: string, homeNickname: string): string {
  return `${awayNickname} vs ${homeNickname} today`;
}

/** Sunday Ticket inside YouTube TV: "{Away} vs {Home} NFL ST today". */
export function sundayTicketSearchQuery(awayNickname: string, homeNickname: string): string {
  return `${awayNickname} vs ${homeNickname} NFL ST today`;
}

export interface ServiceWatchUrlInput {
  service: UserService;
  awayNickname: string;
  homeNickname: string;
  /** Kickoff instant. Unused for Prime. */
  kickoff: Date | null;
  /** Airing this link is for. The search phrase does not include it. */
  network: AiringNetwork;
  /** `prime_event_gti.gti` for this game. Absent, Prime opens the app home. */
  primeGti?: string | null;
}

/**
 * Watch URL for one service and game.
 *
 * YouTube TV searches "{Away} vs {Home} today". Sunday Ticket searches
 * "{Away} vs {Home} NFL ST today". DirecTV searches "{Away} vs {Home}". Prime with a
 * GTI opens `https://app.primevideo.com/detail?gti=…`. With no GTI it opens the Prime
 * app home. Web opens `PRIME_VIDEO_WEB_STOREFRONT`.
 * NFL+, ESPN, Paramount+, and Peacock use `USER_SERVICE_LANDING_URLS`. The ESPN app scheme is
 * chosen on the device, not here.
 */
export function serviceWatchUrl(input: ServiceWatchUrlInput): string {
  const namesReady = input.awayNickname.length > 0 && input.homeNickname.length > 0;
  if (input.service === 'sunday_ticket' && namesReady) {
    return `${YOUTUBE_TV_SEARCH}${encodeURIComponent(
      sundayTicketSearchQuery(input.awayNickname, input.homeNickname),
    )}`;
  }
  if (input.service === 'directv' && namesReady) {
    const query = encodeURIComponent(`${input.awayNickname} vs ${input.homeNickname}`);
    return `${DIRECTV_SEARCH}${query}`;
  }
  if (input.service === 'youtube_tv' && namesReady) {
    const query = encodeURIComponent(matchupSearchQuery(input.awayNickname, input.homeNickname));
    return `${YOUTUBE_TV_SEARCH}${query}`;
  }
  if (input.service === 'amazon_prime') {
    return primeDetailUrl(input.primeGti) ?? PRIME_APP_HOME_URL;
  }
  return USER_SERVICE_LANDING_URLS[input.service];
}
