import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../../components/PrimaryButton';
import { TextButton } from '../../components/TextButton';
import { usePushPermission } from '../../contexts/PushPermissionContext';
import { desktopAlertCopy, lastDesktopAlertState } from '../../lib/desktopAlerts';
import { writeNotifPromptDismissed } from '../../lib/navigationGates';
import { theme } from '../../lib/theme';

/**
 * PLAN.md Section 10 onboarding step 5 ("Notifications. Pre-permission screen explaining why
 * before triggering iOS prompt").
 *
 * Two entry paths (Sprint 10 Phase 4):
 * - Onboarding chain: `?onboarding=1` from streaming; after the OS prompt, layout leaves to all-set.
 * - Catch-all: `(app)/_layout` when Home + leagues >= 1 + still `'undetermined'`; leave → Home.
 *   Web only: "Not now" snoozes that catch-all for 7 days. The native screen has no dismiss.
 */
export default function NotificationsPermissionScreen() {
  const router = useRouter();
  const { requestAndRegister } = usePushPermission();
  const [isRequesting, setIsRequesting] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const onWeb = Platform.OS === 'web';

  const onEnable = async () => {
    setIsRequesting(true);
    try {
      await requestAndRegister();
      if (onWeb) setDetail(desktopAlertCopy(lastDesktopAlertState()));
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
        {detail ? <Text style={styles.body}>{detail}</Text> : null}

        <PrimaryButton
          label={onWeb ? 'Enable desktop alerts' : 'Enable notifications'}
          loading={isRequesting}
          onPress={onEnable}
          style={styles.button}
        />
        {onWeb ? (
          <TextButton
            label="Not now"
            onPress={() => {
              writeNotifPromptDismissed({
                platform: Platform.OS,
                writeItem: (key, value) => {
                  globalThis.localStorage.setItem(key, value);
                },
              });
              router.replace('/(app)');
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.body.weight,
    lineHeight: theme.type.body.lineHeight,
  },
  button: {
    marginTop: theme.spacing.md,
  },
  card: {
    gap: theme.spacing.md2,
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
