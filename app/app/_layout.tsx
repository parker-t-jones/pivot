import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '../contexts/SessionContext';
import { theme } from '../lib/theme';

function LoadingState({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator color={theme.colors.accent} size="large" />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

function RootNavigator() {
  const { isLoading: isSessionLoading, session } = useSession();
  // Manrope (UI-SPEC.md §2.4 typography pass) — gated into the same loading screen as session
  // restore rather than a second splash step.
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const isLoading = isSessionLoading || !fontsLoaded;
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
      router.replace('/(auth)/welcome');
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
    // Sprint 6 Phase 6: `FlagEventBanner` reads safe-area insets so it slides in below the status
    // bar/notch. `expo-router`'s bundled `react-navigation` already wraps screens in a
    // `SafeAreaProvider` internally, but `NotificationBannerHost` renders as an overlay sibling to
    // (not nested inside) the navigator, so it needs its own provider higher up the tree.
    <SafeAreaProvider>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  loadingText: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.button.size,
  },
});
