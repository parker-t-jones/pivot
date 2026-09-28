import type { UserService } from './types.js';

/**
 * App-level landing per user service until the `(service, network)` deep-link table lands (B1.5).
 * Same URLs `scripts/seed-broadcasts.ts` writes for these apps; YouTube TV shares Sunday Ticket's
 * device-confirmed `/live` landing. None of these is a game-level link.
 */
export const USER_SERVICE_LANDING_URLS: Record<UserService, string> = {
  youtube_tv: 'https://tv.youtube.com/live',
  sunday_ticket: 'https://tv.youtube.com/live',
  hulu_live: 'https://www.hulu.com/hub/sports', // unverified AASA
  fubo: 'https://www.fubo.tv/', // unverified AASA
  directv: 'https://www.directv.com/', // unverified AASA
  sling: '', // no confirmed carriage, so never emitted
  amazon_prime: 'https://www.primevideo.com/',
  peacock: 'https://www.peacocktv.com/watch/sports',
  paramount_plus: 'https://www.paramountplus.com/',
  espn_plus: 'https://www.espn.com/nfl/team',
  nfl_plus: 'https://www.nfl.com/scores',
};
