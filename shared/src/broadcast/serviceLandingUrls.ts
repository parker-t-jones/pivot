import type { UserService } from './types.js';

/**
 * App-level landing per user service until the `(service, network)` deep-link table lands (B1.5).
 *
 * Verified: each URL not marked otherwise is claimed by the provider's *production* app in its live
 * `apple-app-site-association`, so it opens the app instead of Safari (dev/QA builds often claim
 * paths the shipping app does not — match on the production app ID only). Bare homepages usually
 * fail this; YouTube TV's AASA carries a literal `NOT /`.
 *
 * YouTube TV, Sunday Ticket, Prime Video, and DirecTV are per game (`serviceWatchUrl`). The values
 * below are what we emit when a matchup nickname or kickoff is missing, plus the static landings.
 */
export const USER_SERVICE_LANDING_URLS: Record<UserService, string> = {
  // Fallback when nicknames are missing. A real game uses `serviceWatchUrl`'s /search/ link.
  youtube_tv: 'https://tv.youtube.com/live',
  sunday_ticket: 'https://tv.youtube.com/live',
  hulu_live: 'https://www.hulu.com/hub/sports', // unverified AASA
  fubo: 'https://www.fubo.tv/', // unverified AASA
  // Fallback when nicknames are missing. A real game uses stream.directv.com/search.
  directv: 'https://www.directv.com/',
  sling: '', // no confirmed carriage, so never emitted
  // Fallback when nicknames or kickoff are missing. A real game uses the app.primevideo.com search.
  amazon_prime: 'https://www.primevideo.com/',
  peacock: 'https://www.peacocktv.com/watch/sports',
  // Device-tested Oct 2 2026: opens the app. Landing inside the app was unverified (no account).
  paramount_plus: 'https://www.paramountplus.com/live-tv/',
  // `/watch/*` is claimed only by ESPN's dogfood/QA builds; production `com.espn.ScoreCenter` claims `/nfl/team`.
  espn_plus: 'https://www.espn.com/nfl/team',
  nfl_plus: 'https://www.nfl.com/scores',
};
