import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePushPermission } from '../../contexts/PushPermissionContext';

/**
 * PLAN.md Section 10 onboarding step 5 ("Notifications. Pre-permission screen explaining why
 * before triggering iOS prompt"). Sprint 6 Phase 5 decision #2: the iOS system prompt only fires
 * after the user taps this screen's CTA — never on cold start with no context, which makes the
 * system prompt itself more likely to be accepted. `(app)/_layout.tsx`'s redirect gate is what
 * routes here (only when permission is `'undetermined'`) and away again once it isn't.
 */
export default function NotificationsPermissionScreen() {
  const { requestAndRegister } = usePushPermission();
  const [isRequesting, setIsRequesting] = useState(false);

  const onEnable = async () => {
    setIsRequesting(true);
    try {
      await requestAndRegister();
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Never miss the moment</Text>
        <Text style={styles.body}>
          Fantasy Focus watches every game your players are in. When one of them takes the field —
          or a big play changes who has the ball — we&apos;ll send you a notification so you can
          switch over before you miss it.
        </Text>
        <Text style={styles.body}>You can turn these off any time in Settings.</Text>

        <Pressable disabled={isRequesting} onPress={onEnable} style={styles.button}>
          {isRequesting ? (
            <ActivityIndicator color="#fff" />
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
    color: '#444',
    fontSize: 15,
    lineHeight: 21,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    marginTop: 12,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    gap: 14,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
});
