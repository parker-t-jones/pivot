import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { SessionProvider, useSession } from '../contexts/SessionContext';

function LoadingState({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

function RootNavigator() {
  const { isLoading, session } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const inAuthGroup = segments[0] === '(auth)';

  const shouldRedirectToAuth = !isLoading && !session && !inAuthGroup;
  const shouldRedirectToApp = !isLoading && !!session && inAuthGroup;

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (shouldRedirectToAuth) {
      router.replace('/(auth)/sign-in');
      return;
    }

    if (shouldRedirectToApp) {
      router.replace('/(app)');
    }
  }, [isLoading, router, shouldRedirectToApp, shouldRedirectToAuth]);

  if (isLoading) {
    return <LoadingState message="Loading session..." />;
  }

  if (shouldRedirectToAuth || shouldRedirectToApp) {
    return <LoadingState message="Redirecting..." />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#444',
    fontSize: 16,
  },
});
