import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '../lib/theme';

/** Decorative block; SkeletonGroup owns the screen's single accessible progressbar. */
export function Skeleton({ style }: { style: StyleProp<ViewStyle> }) {
  return <View style={[styles.block, style]} />;
}

export function SkeletonGroup({ children }: { children: ReactNode }) {
  // Native starts still until the asynchronous accessibility preference is known.
  const [reduced, setReduced] = useState(() =>
    Platform.OS === 'web' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true,
  );
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true;
    if (Platform.OS === 'web' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const change = () => setReduced(query.matches);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    }
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active && !changed) setReduced(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    opacity.setValue(1);
    if (reduced) return;
    const pulse = Animated.loop(
      Animated.sequence(
        [theme.opacity.disabled, 1].map((toValue) =>
          Animated.timing(opacity, {
            toValue,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ),
      ),
    );
    pulse.start();
    return () => {
      pulse.stop();
      opacity.setValue(1);
    };
  }, [opacity, reduced]);
  return (
    <Animated.View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={{ opacity }}
      testID={reduced ? 'skeleton-still' : 'skeleton-pulse'}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radii.lg },
});
