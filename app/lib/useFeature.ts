import { useSyncExternalStore } from 'react';

import { getBetsEnabled, subscribeBets } from './featureGate';

/** Server flag for this user, or the dev-only `SHOW_BETS` override. */
export function useFeature(name: 'bets'): boolean {
  const bets = useSyncExternalStore(subscribeBets, getBetsEnabled, getBetsEnabled);
  return name === 'bets' ? bets : false;
}
