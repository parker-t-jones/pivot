import type { UserService } from './types.js';

/**
 * App-level landing per user service until the `(service, network)` deep-link table lands (B1.5).
 *
 * Verified: each URL not marked otherwise is claimed by the provider's *production* app in its live
 * `apple-app-site-association`, so it opens the app instead of Safari (dev/QA builds often claim
 * paths the shipping app does not — match on the production app ID only). Bare homepages usually
 * fail this; YouTube TV's AASA carries a literal `NOT /`.
 *
 * Not verified: that the app lands on the right *content*. None of these is a game-level link
 * (PLAN.md Open Question #2); an AASA says which paths open an app, never which are valid content.
 */
export const USER_SERVICE_LANDING_URLS: Record<UserService, string> = {
  // Device-confirmed on a physical iPhone (Sprint 10 Track B); YouTube TV shares Sunday Ticket's app.
  youtube_tv: 'https://tv.youtube.com/live',
  sunday_ticket: 'https://tv.youtube.com/live',
  hulu_live: 'https://www.hulu.com/hub/sports', // unverified AASA
  fubo: 'https://www.fubo.tv/', // unverified AASA
  directv: 'https://www.directv.com/', // unverified AASA
  sling: '', // no confirmed carriage, so never emitted
  // Prime Video's AASA lives on primevideo.com; amazon.com/gp/video is claimed by no Amazon app.
  amazon_prime: 'https://www.primevideo.com/',
  peacock: 'https://www.peacocktv.com/watch/sports',
  // Paramount+'s AASA claims `/` outright.
  paramount_plus: 'https://www.paramountplus.com/',
  // `/watch/*` is claimed only by ESPN's dogfood/QA builds; production `com.espn.ScoreCenter` claims `/nfl/team`.
  espn_plus: 'https://www.espn.com/nfl/team',
  nfl_plus: 'https://www.nfl.com/scores',
};
