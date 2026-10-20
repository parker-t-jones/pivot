import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadingState } from '../components/LoadingState';
import { WebPhoneColumn } from '../components/WebPhoneColumn';
import { SessionProvider, useSession } from '../contexts/SessionContext';
import { getOrCreateDeviceId } from '../lib/deviceId';
import { displayFontMap } from '../lib/fonts';
import { resolveRootAuthRedirect } from '../lib/navigationGates';
import { registerServiceWorker } from '../lib/webPush';

function RootNavigator() {
  const { isLoading, session } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const inAuthGroup = segments[0] === '(auth)';
  // The fixture preview has no session and no leagues. Production builds never take this branch.
  const devPreview = __DEV__ && segments[0] === 'live-card-preview';
  const redirect = resolveRootAuthRedirect({
    isLoading,
    hasSession: !!session,
    inAuthGroup,
    devPreview,
    topSegment: segments[0],
  });

  useEffect(() => {
    if (redirect === 'redirect_auth') {
      router.replace('/(auth)/welcome');
      return;
    }
    if (redirect === 'redirect_app') {
      router.replace('/(app)');
    }
  }, [redirect, router]);

  if (redirect === 'wait') {
    return <LoadingState message="Loading session..." />;
  }

  if (redirect === 'redirect_auth' || redirect === 'redirect_app') {
    return <LoadingState message="Redirecting..." />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="live-card-preview" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts(displayFontMap);

  useEffect(() => {
    void getOrCreateDeviceId();
    if (Platform.OS === 'web') registerServiceWorker();
  }, []);

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <WebPhoneColumn>
          <LoadingState message="Loading..." />
        </WebPhoneColumn>
      </SafeAreaProvider>
    );
  }

  return (
    // Sprint 6 Phase 6: `FlagEventBanner` reads safe-area insets so it slides in below the status
    // bar/notch. `expo-router`'s bundled `react-navigation` already wraps screens in a
    // `SafeAreaProvider` internally, but `NotificationBannerHost` renders as an overlay sibling to
    // (not nested inside) the navigator, so it needs its own provider higher up the tree.
    // `WebPhoneColumn` is a no-op view on native.
    <SafeAreaProvider>
      <WebPhoneColumn>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </WebPhoneColumn>
    </SafeAreaProvider>
  );
}
