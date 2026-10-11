/**
 * `FEATURE_BETS` is parsed once at API startup (`loadFeatureBets` from `index.ts`).
 * `off` (and unset) hides bets. `all` enables them for every user. A comma-separated
 * list of user ids is an allowlist. Anything else is `off`.
 */
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FEATURE_BETS_INVALID = '[features] FEATURE_BETS invalid, using off';

export type BetsFeature =
  | { readonly kind: 'off' }
  | { readonly kind: 'all' }
  | { readonly kind: 'allowlist'; readonly userIds: ReadonlySet<string> };

export function parseFeatureBets(
  raw: string | undefined,
  log: (message: string) => void = console.error,
): BetsFeature {
  if (raw === undefined) return { kind: 'off' };
  const value = raw.trim();
  if (value === '' || value === 'off') return { kind: 'off' };
  if (value === 'all') return { kind: 'all' };
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (ids.length > 0 && ids.every((id) => USER_ID.test(id))) {
    return { kind: 'allowlist', userIds: new Set(ids) };
  }
  log(FEATURE_BETS_INVALID);
  return { kind: 'off' };
}

export function betsOnFor(feature: BetsFeature, userId: string): boolean {
  if (feature.kind === 'all') return true;
  if (feature.kind === 'allowlist') return feature.userIds.has(userId);
  return false;
}

let current: BetsFeature = { kind: 'off' };

/** Called once from the API entrypoint. Tests call it again to simulate another process. */
export function loadFeatureBets(
  raw: string | undefined,
  log: (message: string) => void = console.error,
): void {
  current = parseFeatureBets(raw, log);
}

export function betsEnabledForUser(userId: string): boolean {
  return betsOnFor(current, userId);
}
