import { useCallback, useEffect, useState } from 'react';

export const HOME_SEGMENTS = [
  { key: 'board', label: 'BOARD' },
  { key: 'my_card', label: 'MY CARD' },
] as const;

export type HomeSegmentKey = (typeof HOME_SEGMENTS)[number]['key'];

/**
 * Session-only segment memory (PIVOT-STAKES-PLAN.md §11.3), shared by the pre-game and live views
 * so the selection survives a branch change (a flag firing, a kickoff). Survives tab switches and
 * backgrounding because the JS module stays warm; resets to BOARD on a cold start because the
 * module reloads. Deliberately not AsyncStorage / preferences.
 */
let rememberedSegment: HomeSegmentKey = 'board';
const segmentListeners = new Set<(key: HomeSegmentKey) => void>();

/** Show the full slate so a routed game's row is mounted. */
export function focusHomeBoard(): void {
  rememberedSegment = 'board';
  for (const listener of segmentListeners) listener('board');
}

export function useHomeSegment(): [HomeSegmentKey, (key: string) => void] {
  const [segment, setSegment] = useState<HomeSegmentKey>(rememberedSegment);
  const select = useCallback((key: string) => {
    if (key !== 'board' && key !== 'my_card') return;
    rememberedSegment = key;
    setSegment(key);
  }, []);
  useEffect(() => {
    segmentListeners.add(setSegment);
    return () => {
      segmentListeners.delete(setSegment);
    };
  }, []);
  return [segment, select];
}
