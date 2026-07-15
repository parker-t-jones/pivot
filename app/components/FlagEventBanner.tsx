import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { FlagEventPayload } from '../lib/flagEventPayload';
import type { NotificationUserAction } from '../lib/notificationActions';

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
        style={[styles.card, { paddingTop: insets.top + 12, transform: [{ translateY }] }]}
      >
        <Text numberOfLines={1} style={styles.title}>
          {banner.title}
        </Text>
        <Text numberOfLines={2} style={styles.body}>
          {banner.body}
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={() => onAction('dismissed')} style={styles.dismissButton}>
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </Pressable>
          <Pressable onPress={() => onAction('switched')} style={styles.switchButton}>
            <Text style={styles.switchButtonText}>Switch</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  body: {
    color: '#333',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    elevation: 8,
    marginHorizontal: 12,
    marginTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  dismissButton: {
    alignItems: 'center',
    backgroundColor: '#EDEDED',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 12,
  },
  dismissButtonText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '600',
  },
  switchButton: {
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 12,
  },
  switchButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
  },
});
