/**
 * Watch-link selection for Home "Watch on…", Also Flagged "Switch", and the push Switch action.
 *
 * iOS hands an https universal link to an installed app only when `Linking.openURL` is used.
 * An in-app browser never does. A custom scheme is tried first, and only when `canOpen` says
 * an app claims it; otherwise the https link is the fallback. https itself is not probed with
 * `canOpenURL` — that check is unreliable for universal links and is what `LSApplicationQueriesSchemes`
 * exists for, which applies to custom schemes only.
 *
 * This module does not invent schemes. Callers pass a scheme only after it has been confirmed.
 */

const HTTP_URL = /^https?:\/\//i;

/** True for `aiv://…` and any other non-http(s) URL. */
export function isCustomSchemeUrl(url: string): boolean {
  return !HTTP_URL.test(url);
}

export interface WatchLinkInput {
  /** https universal link already resolved for this user and game. */
  httpsUrl: string;
  /** Optional custom-scheme URL. Empty or http(s) values are ignored. */
  schemeUrl?: string | null;
}

/**
 * Fallback order: a custom scheme when one was supplied, then the https link.
 * Blank input is dropped. An http(s) value in `schemeUrl` is not treated as a scheme.
 */
export function watchLinkAttemptOrder(input: WatchLinkInput): string[] {
  const httpsUrl = input.httpsUrl.trim();
  const schemeUrl = input.schemeUrl?.trim() ?? '';
  const attempts: string[] = [];
  if (schemeUrl.length > 0 && isCustomSchemeUrl(schemeUrl)) {
    attempts.push(schemeUrl);
  }
  if (httpsUrl.length > 0) {
    attempts.push(httpsUrl);
  }
  return attempts;
}

/**
 * Picks the URL to open. Custom schemes are used only when `canOpen` returns true.
 * The https link is returned without asking `canOpen`.
 */
export async function selectWatchLink(
  input: WatchLinkInput,
  canOpen: (url: string) => Promise<boolean>,
): Promise<string | null> {
  for (const url of watchLinkAttemptOrder(input)) {
    if (!isCustomSchemeUrl(url)) return url;
    if (await canOpen(url)) return url;
  }
  return null;
}
