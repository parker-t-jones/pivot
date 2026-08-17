/**
 * Reference semantics for `public.search_players` (migration
 * `20260816010000_search_players.sql`). Kept in TS so unit tests can lock the
 * word-prefix + AND-across-tokens contract without a live DB. If you change the
 * SQL, update this and the tests together.
 */

export function buildPlayerSearchText(parts: {
  first_name: string;
  last_name: string;
  position: string;
  city: string;
  name: string;
  abbreviation: string;
}): string {
  const nameParts = [parts.first_name, parts.last_name];
  const teamParts =
    parts.position === 'DEF' ? [parts.city, parts.name, parts.abbreviation] : [];
  return [...nameParts, ...teamParts]
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .toLowerCase();
}

/** Escape `\`, `%`, `_` for PostgreSQL `LIKE … ESCAPE '\'`. */
export function escapeLikePrefix(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Every whitespace token in `query` must be a case-insensitive prefix of some
 * whitespace-separated word in `searchText`.
 */
export function playerSearchTextMatches(searchText: string, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  const words = searchText.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}
