import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../../contexts/SessionContext';
import { supabase } from '../../lib/supabase';

export default function HomeScreen() {
  const { user } = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSignOut = async () => {
    setErrorMessage(null);
    setIsSigningOut(true);

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
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
});
