import { USER_SERVICE_LANDING_URLS } from './serviceLandingUrls.js';
import type { AiringNetwork, UserService } from './types.js';

/** Device-tested YouTube TV / Sunday Ticket search. Never a `/nflst/` path. */
const YOUTUBE_TV_SEARCH = 'https://tv.youtube.com/search/';

/** Device-tested Prime Video search. https only. */
const PRIME_VIDEO_SEARCH = 'https://app.primevideo.com/search?phrase=';

const THURSDAY_NIGHT_FOOTBALL = 'Thursday Night Football';

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

export interface ServiceWatchUrlInput {
  service: UserService;
  awayNickname: string;
  homeNickname: string;
  /** Kickoff instant. Thursday in America/New_York selects the Prime TNF query. */
  kickoff: Date | null;
  /** Airing this link is for. The search phrase does not include it. */
  network: AiringNetwork;
}

/**
 * Watch URL for one service and game.
 *
 * YouTube TV and Sunday Ticket search "{Away} vs {Home} today". Prime searches
 * "Thursday Night Football" on a Thursday kickoff (Eastern) and the same matchup query otherwise.
 * NFL+, ESPN, Paramount+, and Peacock use `USER_SERVICE_LANDING_URLS`. The ESPN app scheme is
 * chosen on the device, not here.
 */
export function serviceWatchUrl(input: ServiceWatchUrlInput): string {
  const namesReady = input.awayNickname.length > 0 && input.homeNickname.length > 0;
  if ((input.service === 'youtube_tv' || input.service === 'sunday_ticket') && namesReady) {
    const query = encodeURIComponent(
      matchupSearchQuery(input.awayNickname, input.homeNickname),
    );
    return `${YOUTUBE_TV_SEARCH}${query}`;
  }
  if (input.service === 'amazon_prime' && namesReady && input.kickoff !== null) {
    const phrase = isThursdayEt(input.kickoff)
      ? THURSDAY_NIGHT_FOOTBALL
      : matchupSearchQuery(input.awayNickname, input.homeNickname);
    return `${PRIME_VIDEO_SEARCH}${encodeURIComponent(phrase)}`;
  }
  return USER_SERVICE_LANDING_URLS[input.service];
}
