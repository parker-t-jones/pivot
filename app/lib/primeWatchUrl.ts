import { httpsWatchUrl } from './watchLink';

const PRIME_WEB_SEARCH = 'https://www.primevideo.com/search';

/** Nicknames from the same fields the YouTube TV link uses (`away_team_name` / `home_team_name`). */
export interface WatchMatchup {
  awayNickname?: string | null;
  homeNickname?: string | null;
}

/**
 * Web Prime search. `URLSearchParams` encodes spaces as `+`.
 * Phrase is "{Away nickname} vs {Home nickname}", with no "today" suffix.
 */
export function primeWebSearchUrl(awayNickname: string, homeNickname: string): string {
  const params = new URLSearchParams({
    ie: 'UTF8',
    phrase: `${awayNickname} vs ${homeNickname}`,
  });
  return `${PRIME_WEB_SEARCH}?${params.toString()}`;
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
 * URL to open in the browser. Prime's native `app.primevideo.com` link is the Get-the-app page
 * on web, so a Prime https URL is replaced with the web search when both nicknames are present.
 * Every other service keeps the https link W3 already opens.
 */
export function webWatchUrl(
  deepLinkUrl: string | null | undefined,
  matchup: WatchMatchup,
): string | null {
  const httpsUrl = httpsWatchUrl(deepLinkUrl);
  if (httpsUrl === null) return null;
  const away = matchup.awayNickname?.trim() ?? '';
  const home = matchup.homeNickname?.trim() ?? '';
  if (away.length === 0 || home.length === 0 || !isPrimeHttps(httpsUrl)) return httpsUrl;
  return primeWebSearchUrl(away, home);
}
