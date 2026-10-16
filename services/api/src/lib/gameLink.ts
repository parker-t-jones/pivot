const MAX_URL_LENGTH = 2048;

export interface ParsedGameLink {
  url: string;
  host: string;
}

/**
 * Trim, then accept only an https URL with no credentials and a dotted hostname.
 * `url` is `URL.toString()` so the stored value is the parsed form.
 */
export function parseGameLinkUrl(raw: string): ParsedGameLink | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (!parsed.hostname.includes('.')) return null;

  const url = parsed.toString();
  if (url.length > MAX_URL_LENGTH) return null;
  return { url, host: parsed.hostname };
}
