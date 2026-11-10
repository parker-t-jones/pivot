import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** iOS Reduce Motion, or `prefers-reduced-motion` on web (react-native-web reads the media query). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {
        // Unknown means full motion, which is the platform default.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
