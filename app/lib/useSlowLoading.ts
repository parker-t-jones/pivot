import { useEffect, useState } from 'react';

export function useSlowLoading(isLoading: boolean, thresholdMs = 8000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!isLoading) return;
    const timer = setTimeout(() => setSlow(true), thresholdMs);
    return () => clearTimeout(timer);
  }, [isLoading, thresholdMs]);
  return isLoading && slow;
}

/** Delay cold placeholders, then retain their paint for 300ms to avoid a flash. */
export function useLoadingPlaceholder(loading: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(() => {
    if (loading) {
      if (visible) return;
      const timer = setTimeout(() => {
        setShownAt(Date.now());
        setVisible(true);
      }, 150);
      return () => clearTimeout(timer);
    }
    if (!visible) return;
    const timer = setTimeout(
      () => {
        setVisible(false);
        setShownAt(null);
      },
      Math.max(0, 300 - (Date.now() - (shownAt ?? Date.now()))),
    );
    return () => clearTimeout(timer);
  }, [loading, shownAt, visible]);
  return visible;
}
