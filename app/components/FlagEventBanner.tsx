import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import type { FlagEventPayload } from '../lib/flagEventPayload';
import type { NotificationUserAction } from '../lib/notificationActions';
import { theme } from '../lib/theme';

export interface FlagEventBannerData {
  /** Stable identity for the banner currently being shown — a new value on every arrival is what
   *  makes the effect below re-arm (haptic + slide-in + auto-dismiss timer) for each notification,
   *  including two notifications with identical title/body/payload in a row. */
  key: number;
  title: string;
  body: string;
  payload: FlagEventPayload;
}

interface FlagEventBannerProps {
  banner: FlagEventBannerData;
  onAction: (action: NotificationUserAction) => void;
}

/** PLAN.md Section 10 "In-app banner (foregrounded)": auto-dismiss after 12s. */
const AUTO_DISMISS_MS = 12_000;
const SLIDE_IN_DURATION_MS = 300;

/**
 * Sprint 6 Phase 6 — PLAN.md Section 10's in-app banner, verbatim: slides down from the top, shows
 * the same title/body a push would, two action buttons on the banner itself, semi-transparent
 * backdrop, auto-dismisses after 12s (recorded as `'ignored'`), tap-outside dismisses (recorded as
 * `'dismissed'`). A real component — not `Alert.alert` — so it can be styled, animated, and tested
 * like anything else. `onAction` is a plain callback; `NotificationBannerHost` owns what actually
 * happens with the recorded action (Phase 6: a mock/logging handler; Phase 7: the real endpoint).
 */
export function FlagEventBanner({ banner, onAction }: FlagEventBannerProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-250)).current;

  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    translateY.setValue(-250);
    Animated.timing(translateY, {
      toValue: 0,
      duration: SLIDE_IN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const autoDismissTimer = setTimeout(() => {
      onAction('ignored');
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(autoDismissTimer);
    // Deliberately keyed only on `banner.key`, not `onAction` — re-running this effect is exactly
    // what re-arms the haptic/slide/auto-dismiss timer for each newly-arrived notification, and
    // `onAction` is a fresh closure per render that would otherwise cause spurious re-arms.
  }, [banner.key]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        accessibilityLabel="Dismiss notification"
        onPress={() => onAction('dismissed')}
        style={styles.backdrop}
      />
      <Animated.View
        style={[
          styles.card,
          { paddingTop: insets.top + theme.spacing.md, transform: [{ translateY }] },
        ]}
      >
        <Text numberOfLines={1} style={styles.title}>
          {banner.title}
        </Text>
        <Text numberOfLines={2} style={styles.body}>
          {banner.body}
        </Text>
        <View style={styles.actions}>
          <SecondaryButton
            label="Dismiss"
            onPress={() => onAction('dismissed')}
            style={styles.actionButton}
          />
          <PrimaryButton
            label="Switch"
            onPress={() => onAction('switched')}
            style={styles.actionButton}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md2,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    marginTop: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    elevation: 8,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    shadowColor: theme.colors.background,
    shadowOffset: { width: 0, height: theme.spacing.xs },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: 'Manrope_700Bold',
    fontSize: theme.type.button.size,
  },
});
