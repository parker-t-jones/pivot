import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import { TextButton } from './TextButton';
import { DEMO_ALERT_VISIBLE_MS, type DemoAlert } from '../lib/demoGameDay';
import { playAlertSound } from '../lib/inTabAlerts';
import { theme } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

interface DemoAlertBannerProps {
  alert: DemoAlert;
  /** A new value per arrival, so two alerts in a row each re-arm the cue and the dismiss timer. */
  alertKey: number;
  onDismiss: () => void;
}

const SLIDE_IN_DURATION_MS = 300;
/** Starts the slide fully above the card, whatever its height. */
const SLIDE_FROM = -theme.spacing.huge * 3;

/**
 * The demo's in-app alert (issue #69), in the same look as the real foreground banner
 * (`FlagEventBanner`): a `surface` card that slides in from the top with the same title and body a
 * notification would carry. It exists because the real banner is wired to real flag events (its
 * "Switch" deep-links and records an action through the API), and the demo is local-only. This one
 * has no action beyond Dismiss, so nothing a person taps touches real data or leaves the demo.
 * It is the foreground and web half of delivery: iOS suppresses its own foreground banner, and web
 * has no local scheduling. Auto-dismisses before the next alert can arrive. Reduce Motion skips the
 * slide.
 */
export function DemoAlertBanner({ alert, alertKey, onDismiss }: DemoAlertBannerProps) {
  const reduceMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : SLIDE_FROM)).current;

  useEffect(() => {
    if (Platform.OS === 'web') {
      playAlertSound();
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (reduceMotion) {
      translateY.setValue(0);
    } else {
      translateY.setValue(SLIDE_FROM);
      Animated.timing(translateY, {
        toValue: 0,
        duration: SLIDE_IN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }

    const timer = setTimeout(onDismiss, DEMO_ALERT_VISIBLE_MS);
    return () => clearTimeout(timer);
    // Keyed on the arrival only: `onDismiss` is a fresh closure per render and must not re-arm this.
  }, [alertKey]);

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <Animated.View
        accessibilityLabel={`${alert.title}. ${alert.body}`}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.card, { transform: [{ translateY }] }]}
        testID={`demo-alert-${alert.kind}`}
      >
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.title}
          testID="demo-alert-title"
        >
          {alert.title}
        </Text>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={2}
          style={styles.body}
          testID="demo-alert-body"
        >
          {alert.body}
        </Text>
        <View style={styles.actions}>
          <TextButton label="Dismiss" onPress={onDismiss} size="smallStrong" tone="muted" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-end',
    marginTop: theme.spacing.sm,
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    marginTop: theme.spacing.xs,
  },
  card: {
    ...theme.effects.panelGlow,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  host: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.button.size,
    fontWeight: '700',
  },
});
