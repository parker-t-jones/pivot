import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { NotificationBannerHost } from '../../components/NotificationBannerHost';
import { NotificationResponseHandler } from '../../components/NotificationResponseHandler';
import { PushPermissionProvider, usePushPermission } from '../../contexts/PushPermissionContext';

function LoadingState({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

/**
 * Sprint 6 Phase 5 redirect gate — same `useSegments`/`useRouter` pattern as the root layout's auth
 * gate. Routes to the pre-permission screen only while status is `'undetermined'` (never for
 * `'denied'` — a user who declines still gets full app access, per PLAN.md: push is a secondary
 * channel, WebSocket is primary whenever the app is open), and away from it again the moment the
 * user has answered the OS prompt either way.
 */
function AppNavigator() {
  const { status } = usePushPermission();
  const segments = useSegments();
  const router = useRouter();
  const onPermissionScreen = segments[segments.length - 1] === 'notifications-permission';

  const shouldShowPermissionScreen = status === 'undetermined' && !onPermissionScreen;
  const shouldLeavePermissionScreen =
    status !== 'undetermined' && status !== 'checking' && onPermissionScreen;

  useEffect(() => {
    if (status === 'checking') {
      return;
    }

    if (shouldShowPermissionScreen) {
      router.replace('/(app)/notifications-permission');
      return;
    }

    if (shouldLeavePermissionScreen) {
      router.replace('/(app)');
    }
  }, [status, shouldShowPermissionScreen, shouldLeavePermissionScreen, router]);

  if (status === 'checking') {
    return <LoadingState message="Loading..." />;
  }

  if (shouldShowPermissionScreen || shouldLeavePermissionScreen) {
    return <LoadingState message="Loading..." />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="notifications-permission" />
    </Stack>
  );
}

export default function AppGroupLayout() {
  return (
    <PushPermissionProvider>
      <AppNavigator />
      <NotificationBannerHost />
      <NotificationResponseHandler />
    </PushPermissionProvider>
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
