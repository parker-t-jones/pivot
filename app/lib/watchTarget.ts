import { webWatchUrl, type WatchMatchup } from './primeWatchUrl';

export interface WatchTarget {
  customUrl?: string | null;
  generatedUrl?: string | null;
}

/**
 * A saved stream URL wins. Blank (including `''`) means there is no custom link, so Switch
 * opens the generated one. Both missing is null — nothing to open.
 */
export function resolveWatchUrl({ customUrl, generatedUrl }: WatchTarget): string | null {
  const custom = customUrl?.trim() ?? '';
  if (custom.length > 0) return custom;
  const generated = generatedUrl?.trim() ?? '';
  return generated.length > 0 ? generated : null;
}

/** Web Switch: the URL `window.open` receives inside the click. */
export function webSwitchUrl(input: {
  customUrl?: string | null;
  deepLinkUrl?: string | null;
  matchup: WatchMatchup;
}): string | null {
  return resolveWatchUrl({
    customUrl: input.customUrl,
    generatedUrl: webWatchUrl(input.deepLinkUrl, input.matchup),
  });
}

/** iOS Switch: the URL `Linking.openURL` receives after the overlay. */
export function nativeSwitchUrl(input: WatchTarget): string | null {
  return resolveWatchUrl(input);
}
