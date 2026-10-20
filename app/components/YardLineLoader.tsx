import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import { theme } from '../lib/theme';

export type YardLineLoaderSize = 'screen' | 'section' | 'compact';

const SWEEP_MS = 1600;
const PULSE_MS = 900;

const SIZE: Record<YardLineLoaderSize, { width: number; height: number; ticks: number }> = {
  screen: { width: 280, height: 28, ticks: 11 },
  section: { width: 200, height: 22, ticks: 11 },
  compact: { width: 72, height: 12, ticks: 5 },
};

function prefersReducedMotion(): boolean {
  if (Platform.OS === 'web' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

/**
 * Mini field strip. Amber yard markers sweep the dark field. Reduce-motion holds the
 * markers still and pulses the field's opacity. The accessible name is always "Loading".
 */
export function YardLineLoader({ size }: { size: YardLineLoaderSize }) {
  const spec = SIZE[size];
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const sweep = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = () => setReduced(query.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    sweep.setValue(0);
    opacity.setValue(1);
    if (reduced) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: theme.opacity.disabled,
            duration: PULSE_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: PULSE_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced, sweep]);

  const travel = spec.width - 4;
  const lead = sweep.interpolate({ inputRange: [0, 1], outputRange: [-4, travel] });
  const trail = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-travel * 0.45, travel * 0.72],
  });

  return (
    <Animated.View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[styles.field, { width: spec.width, height: spec.height, opacity }]}
      testID="yard-line-loader"
    >
      {Array.from({ length: spec.ticks }, (_, index) => (
        <View
          key={index}
          style={[
            styles.tick,
            {
              left: spec.ticks === 1 ? '50%' : `${(index / (spec.ticks - 1)) * 100}%`,
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          styles.marker,
          reduced ? { left: spec.width * 0.32 } : { transform: [{ translateX: lead }] },
        ]}
        testID={reduced ? 'yard-line-static' : 'yard-line-sweep'}
      />
      <Animated.View
        style={[
          styles.marker,
          reduced ? { left: spec.width * 0.62 } : { transform: [{ translateX: trail }] },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.sm,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
  },
  marker: {
    backgroundColor: theme.colors.accent,
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  tick: {
    backgroundColor: theme.colors.border,
    bottom: 4,
    marginLeft: -0.5,
    position: 'absolute',
    top: 4,
    width: 1,
  },
});
