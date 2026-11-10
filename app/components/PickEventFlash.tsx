import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { theme } from '../lib/theme';
import type { PickFlash } from '../lib/usePickHitFlash';
import { useReducedMotion } from '../lib/useReducedMotion';

/** How long the lower-third stays up. Long enough to read a prop label. */
export const PICK_FLASH_MS = 2400;
/** The edge-glow pulse, from the issue #44 mockup's 1.5s beat. */
const EDGE_IN_MS = 225;
const EDGE_SETTLE_MS = 450;
const EDGE_OUT_MS = 825;
const EDGE_SETTLE_OPACITY = 0.4;
/** Reduce Motion: the glow and tag just appear, hold, and go. */
const EDGE_STATIC_OPACITY = 0.6;
const TAG_IN_MS = 270;
const TAG_SETTLE_MS = 150;
const TAG_OUT_MS = 330;
const TAG_START_SCALE = 0.5;
const TAG_OVERSHOOT_SCALE = 1.08;
const TAG_END_SCALE = 0.96;

const useNativeDriver = Platform.OS !== 'web';

interface PickEventFlashProps {
  flash: PickFlash | null;
  onDone: () => void;
  /** Keeps the tag above the tab bar / home indicator. */
  bottomInset?: number;
}

/**
 * The one celebration moment for a pick that just hit (issue #44): an edge-glow pulse in
 * `success` and a broadcast-style lower-third naming the pick. Watchlist and the demo game day
 * both render this, fed by `usePickHitFlash`. It never takes touches.
 */
export function PickEventFlash({ flash, onDone, bottomInset = 0 }: PickEventFlashProps) {
  const reduceMotion = useReducedMotion();
  const edge = useRef(new Animated.Value(0)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const tagScale = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const key = flash?.key ?? null;
  const announcement = flash?.announcement ?? null;

  useEffect(() => {
    if (key == null) return;
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement);
    let animation: Animated.CompositeAnimation | null = null;
    if (reduceMotion) {
      edge.setValue(EDGE_STATIC_OPACITY);
      tagOpacity.setValue(1);
      tagScale.setValue(1);
    } else {
      edge.setValue(0);
      tagOpacity.setValue(0);
      tagScale.setValue(TAG_START_SCALE);
      const ease = Easing.out(Easing.cubic);
      const timing = (value: Animated.Value, toValue: number, duration: number) =>
        Animated.timing(value, { toValue, duration, easing: ease, useNativeDriver });
      const hold = PICK_FLASH_MS - TAG_IN_MS - TAG_SETTLE_MS - TAG_OUT_MS;
      animation = Animated.parallel([
        Animated.sequence([
          timing(edge, 1, EDGE_IN_MS),
          timing(edge, EDGE_SETTLE_OPACITY, EDGE_SETTLE_MS),
          timing(edge, 0, EDGE_OUT_MS),
        ]),
        Animated.sequence([
          Animated.parallel([
            timing(tagOpacity, 1, TAG_IN_MS),
            timing(tagScale, TAG_OVERSHOOT_SCALE, TAG_IN_MS),
          ]),
          timing(tagScale, 1, TAG_SETTLE_MS),
          Animated.delay(hold),
          Animated.parallel([
            timing(tagOpacity, 0, TAG_OUT_MS),
            timing(tagScale, TAG_END_SCALE, TAG_OUT_MS),
          ]),
        ]),
      ]);
      animation.start();
    }
    // The timer, not the animation callback, ends the flash, so Reduce Motion holds just as long.
    const timer = setTimeout(() => onDoneRef.current(), PICK_FLASH_MS);
    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [announcement, edge, key, reduceMotion, tagOpacity, tagScale]);

  if (!flash) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="pick-event-flash">
      <Animated.View style={[styles.edge, { opacity: edge }]} testID="pick-event-flash-edge" />
      <View style={[styles.tagRow, { bottom: bottomInset + theme.spacing.xl }]}>
        <Animated.View
          style={[styles.tag, { opacity: tagOpacity, transform: [{ scale: tagScale }] }]}
          testID="pick-event-flash-tag"
        >
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.headline}
          >
            {flash.headline}
          </Text>
          {flash.detail.length > 0 ? (
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              numberOfLines={2}
              style={styles.detail}
            >
              {flash.detail}
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const successGlow = { ...theme.effects.flareGlow, shadowColor: theme.colors.success };

const styles = StyleSheet.create({
  detail: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
    textAlign: 'center',
  },
  edge: {
    ...StyleSheet.absoluteFill,
    ...successGlow,
    borderColor: theme.colors.success,
    borderWidth: theme.spacing.xs,
  },
  headline: {
    color: theme.colors.success,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textAlign: 'center',
  },
  tag: {
    ...successGlow,
    alignItems: 'center',
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.successBorder,
    borderRadius: theme.radii.pill,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: theme.spacing.lg2,
    paddingVertical: theme.spacing.sm,
  },
  tagRow: {
    alignItems: 'center',
    left: theme.spacing.lg,
    position: 'absolute',
    right: theme.spacing.lg,
  },
});
