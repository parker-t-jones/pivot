import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EMPTY_PICK_HIT_TRACKER,
  detectPickHits,
  pickHitCopy,
  type FlashPick,
  type PickHitCopy,
  type PickHitTracker,
} from './pickHitFlash';

export interface PickFlash extends PickHitCopy {
  /** Changes on every new flash, so the component restarts its animation. */
  key: number;
}

/**
 * Diffs each new list of picks against the last one shown and returns the flash to play, if
 * any. In memory only. The Watchlist seeds it with the picks it remembers across a tab remount,
 * so a return from Home compares against what the user last saw. A cold start sets a baseline
 * and never flashes picks that were already hit.
 */
export function usePickHitFlash(picks: readonly FlashPick[]): {
  flash: PickFlash | null;
  dismiss: () => void;
} {
  const trackerRef = useRef<PickHitTracker>(EMPTY_PICK_HIT_TRACKER);
  const keyRef = useRef(0);
  const [flash, setFlash] = useState<PickFlash | null>(null);

  useEffect(() => {
    const { tracker, hits } = detectPickHits(trackerRef.current, picks);
    trackerRef.current = tracker;
    const copy = pickHitCopy(hits);
    if (!copy) return;
    keyRef.current += 1;
    setFlash({ ...copy, key: keyRef.current });
  }, [picks]);

  const dismiss = useCallback(() => setFlash(null), []);
  return { flash, dismiss };
}
