import { PRIME_VIDEO_IOS_DETAIL_URL, PRIME_VIDEO_WEB_STOREFRONT } from '@pivot/shared/broadcast';

import { httpsWatchUrl } from './watchLink';

/** Nicknames from the same fields the YouTube TV link uses (`away_team_name` / `home_team_name`). */
export interface WatchMatchup {
  awayNickname?: string | null;
  homeNickname?: string | null;
}

/**
 * iOS Prime searches open a blank query. The detail URL is what Switch should open.
 * A URL that is already the detail page is unchanged.
 */
export function iosWatchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'app.primevideo.com') return url;
  if (parsed.pathname !== '/search') return url;
  const phrase = parsed.searchParams.get('phrase')?.trim() ?? '';
  if (phrase.length === 0) return url;
  return PRIME_VIDEO_IOS_DETAIL_URL;
}

function isPrimeHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'app.primevideo.com' || parsed.hostname === 'www.primevideo.com')
    );
  } catch {
    return false;
  }
}

/**
 * URL to open in the browser. Prime's `app.primevideo.com` link is the get-the-app splash,
 * so a Prime https URL opens the storefront. Every other service keeps its https link.
 */
export function webWatchUrl(
  deepLinkUrl: string | null | undefined,
  _matchup: WatchMatchup,
): string | null {
  const httpsUrl = httpsWatchUrl(deepLinkUrl);
  if (httpsUrl === null) return null;
  if (!isPrimeHttps(httpsUrl)) return httpsUrl;
  return PRIME_VIDEO_WEB_STOREFRONT;
}
