import { USER_SERVICE_LANDING_URLS } from './serviceLandingUrls.js';
import type { AiringNetwork, UserService } from './types.js';

/** Device-tested YouTube TV / Sunday Ticket search. Never a `/nflst/` path. */
const YOUTUBE_TV_SEARCH = 'https://tv.youtube.com/search/';

/** Device-tested Prime Video search. https only. */
const PRIME_VIDEO_SEARCH = 'https://app.primevideo.com/search?phrase=';

const THURSDAY_NIGHT_FOOTBALL = 'Thursday Night Football';

/**
 * Words appended to a YouTube TV / Sunday Ticket matchup search. "Colts vs Commanders" opened a
 * populated result with no live airing; appending the network showed the live game.
 * NFL Network's search phrase is "NFL Net", the name YouTube TV uses.
 */
const NETWORK_SEARCH_PHRASE: Record<AiringNetwork, string> = {
  cbs: 'CBS',
  fox: 'FOX',
  nbc: 'NBC',
  abc: 'ABC',
  espn: 'ESPN',
  amazon_prime: 'Prime Video',
  peacock: 'Peacock',
  nfl_network: 'NFL Net',
  netflix: 'Netflix',
  espn_plus: 'ESPN+',
  nfl_plus: 'NFL+',
  paramount_plus: 'Paramount+',
};

export function isThursdayEt(kickoff: Date): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(kickoff);
  return weekday === 'Thursday';
}

/** "{Away nickname} vs {Home nickname}", plus the network search phrase when one is given. */
export function matchupSearchQuery(
  awayNickname: string,
  homeNickname: string,
  network?: AiringNetwork,
): string {
  const matchup = `${awayNickname} vs ${homeNickname}`;
  if (network === undefined) return matchup;
  return `${matchup} ${NETWORK_SEARCH_PHRASE[network]}`;
}

export interface ServiceWatchUrlInput {
  service: UserService;
  awayNickname: string;
  homeNickname: string;
  /** Kickoff instant. Thursday in America/New_York selects the Prime TNF query. */
  kickoff: Date | null;
  /** Airing this link is for. YouTube TV and Sunday Ticket append its search phrase. */
  network: AiringNetwork;
}

/**
 * Watch URL for one service and game.
 *
 * YouTube TV and Sunday Ticket search "{Away} vs {Home} {network}". Prime searches
 * "Thursday Night Football" on a Thursday kickoff (Eastern) and the matchup query otherwise.
 * NFL+, ESPN, Paramount+, and Peacock use `USER_SERVICE_LANDING_URLS`. The ESPN app scheme is
 * chosen on the device, not here.
 */
export function serviceWatchUrl(input: ServiceWatchUrlInput): string {
  const namesReady = input.awayNickname.length > 0 && input.homeNickname.length > 0;
  if ((input.service === 'youtube_tv' || input.service === 'sunday_ticket') && namesReady) {
    const query = encodeURIComponent(
      matchupSearchQuery(input.awayNickname, input.homeNickname, input.network),
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
