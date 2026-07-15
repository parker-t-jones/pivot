import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../../contexts/SessionContext';
import { scheduleTestFlagNotificationAsync } from '../../lib/devNotifications';
import { supabase } from '../../lib/supabase';
import { unregisterPushNotificationsAsync } from '../../lib/pushNotifications';

export default function HomeScreen() {
  const { user } = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);

  /** PLAN.md Section 10 Home State 3's "Subtle 'Test notifications' link" — doubles as Sprint 6
   *  Phase 6's simulator-friendly way to exercise the foreground banner end-to-end without a real
   *  push (see `lib/devNotifications.ts`). */
  const onTestNotifications = async () => {
    setIsSendingTestNotification(true);
    try {
      await scheduleTestFlagNotificationAsync();
    } finally {
      setIsSendingTestNotification(false);
    }
  };

  /**
   * Sprint 6 Phase 5 decision #4: unregister BEFORE clearing the session — `unregisterPushNotificationsAsync`
   * needs a valid JWT to call `DELETE /me/push-token` (it's best-effort internally and never throws,
   * so a network failure here can't block sign-out below it).
   */
  const onSignOut = async () => {
    setErrorMessage(null);
    setIsSigningOut(true);

    if (user) {
      await unregisterPushNotificationsAsync(user.id);
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      setErrorMessage(error.message);
    }

    setIsSigningOut(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.subtitle}>Signed in as:</Text>
      <Text style={styles.email}>{user?.email ?? 'Unknown email'}</Text>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable disabled={isSigningOut} onPress={onSignOut} style={styles.button}>
        {isSigningOut ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign out</Text>
        )}
      </Pressable>

      <Pressable disabled={isSendingTestNotification} onPress={onTestNotifications}>
        <Text style={styles.testNotificationsLink}>
          {isSendingTestNotification ? 'Sending in 2s…' : 'Test notifications'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 8,
    marginTop: 20,
    minWidth: 150,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  email: {
    fontSize: 17,
    fontWeight: '600',
  },
  error: {
    color: '#B00020',
    fontSize: 14,
    marginTop: 8,
  },
  subtitle: {
    color: '#555',
    fontSize: 14,
  },
  testNotificationsLink: {
    color: '#888',
    fontSize: 13,
    marginTop: 16,
    textDecorationLine: 'underline',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
});
