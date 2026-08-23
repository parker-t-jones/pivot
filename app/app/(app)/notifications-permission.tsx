import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePushPermission } from '../../contexts/PushPermissionContext';
import { theme } from '../../lib/theme';

/**
 * PLAN.md Section 10 onboarding step 5 ("Notifications. Pre-permission screen explaining why
 * before triggering iOS prompt").
 *
 * Two entry paths (Sprint 10 Phase 4):
 * - Onboarding chain: `?onboarding=1` from streaming; after the OS prompt, layout leaves to all-set.
 * - Catch-all: `(app)/_layout` when Home + leagues >= 1 + still `'undetermined'`; leave → Home.
 */
export default function NotificationsPermissionScreen() {
  const { requestAndRegister } = usePushPermission();
  const [isRequesting, setIsRequesting] = useState(false);

  const onEnable = async () => {
    setIsRequesting(true);
    try {
      await requestAndRegister();
      // Layout `leave_notifications` navigates once status leaves `'undetermined'`.
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Never miss the moment</Text>
        <Text style={styles.body}>
          Pivot watches every game your players are in. When one of them takes the field — or a big
          play changes who has the ball — we&apos;ll send you a notification so you can switch over
          before you miss it.
        </Text>
        <Text style={styles.body}>You can turn these off any time in Settings.</Text>

        <Pressable disabled={isRequesting} onPress={onEnable} style={styles.button}>
          {isRequesting ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>Enable notifications</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.body.weight,
    lineHeight: 21,
  },
  button: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    marginTop: theme.spacing.md,
    paddingVertical: 14,
  },
  buttonText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    gap: 14,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
