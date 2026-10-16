/** One saved stream URL for a user and a game. The dispatcher calls this once per fan-out. */
export interface SavedGameLinkLookup {
  urlFor(userId: string, gameId: string): Promise<string | null>;
}

/** A hung lookup must not hold the push. Past this, the push goes out without `saved_url`. */
export const SAVED_LINK_LOOKUP_MS = 300;

/**
 * Read the saved URL, or `null` when there is no row, the lookup throws, or it exceeds
 * {@link SAVED_LINK_LOOKUP_MS}. Logs at most once. Never throws.
 */
export async function lookupSavedGameLink(
  lookup: SavedGameLinkLookup,
  userId: string,
  gameId: string,
): Promise<string | null> {
  let logged = false;
  const warn = (line: string): void => {
    if (logged) return;
    logged = true;
    console.warn(line);
  };

  const pending = lookup.urlFor(userId, gameId).then(
    (url) => (typeof url === 'string' && url.length > 0 ? url : null),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      warn(`[web-push] saved link lookup failed user=${userId} game=${gameId} err=${message}`);
      return null;
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      warn(`[web-push] saved link lookup timed out user=${userId} game=${gameId}`);
      resolve(null);
    }, SAVED_LINK_LOOKUP_MS);
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Web Push copy of the flag payload. `savedUrl` is set only when a row exists, so the
 * field is absent otherwise. The input object is not mutated.
 */
export function withSavedUrl<T extends { action: object }>(payload: T, savedUrl: string | null): T {
  if (savedUrl === null) return payload;
  return { ...payload, action: { ...payload.action, saved_url: savedUrl } };
}
