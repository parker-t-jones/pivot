import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../../contexts/SessionContext';

export default function HomeScreen() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const displayEmail =
    session?.user.email !== undefined && session.user.email.length > 0
      ? session.user.email
      : 'Unknown email';

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.replace('/(auth)/sign-in');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{displayEmail}</Text>

      <Pressable
        style={[styles.button, signingOut && styles.buttonDisabled]}
        onPress={() => void onSignOut()}
        disabled={signingOut}
      >
        {signingOut ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonLabel}>Sign out</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#555',
  },
  email: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 24,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
