import { SHOW_BETS } from './featureFlags';

/** What `GET /me` may say about a flag. A missing `features` key is an older server. */
export interface MeFeatures {
  features?: { bets?: boolean };
}

/**
 * `SHOW_BETS` is a dev-only override (kept false in commits). Otherwise the server flag wins.
 * A missing `features` key is off.
 */
export function featureEnabled(
  name: 'bets',
  me: MeFeatures | null | undefined,
  devOverride = SHOW_BETS,
): boolean {
  if (name !== 'bets') return false;
  if (devOverride) return true;
  return me?.features?.bets === true;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let betsEnabled = featureEnabled('bets', undefined);

export function noteMeFeatures(me: MeFeatures | null): void {
  const next = featureEnabled('bets', me);
  if (next === betsEnabled) return;
  betsEnabled = next;
  for (const listener of listeners) listener();
}

export function subscribeBets(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBetsEnabled(): boolean {
  return betsEnabled;
}
