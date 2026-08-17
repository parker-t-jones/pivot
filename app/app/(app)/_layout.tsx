import { Stack, useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ErrorState } from '../../components/ErrorState';
import { NotificationBannerHost } from '../../components/NotificationBannerHost';
import { NotificationResponseHandler } from '../../components/NotificationResponseHandler';
import { LeaguesGateProvider, useLeaguesGate } from '../../contexts/LeaguesGateContext';
import { PushPermissionProvider, usePushPermission } from '../../contexts/PushPermissionContext';
import { SwitchingProvider } from '../../contexts/SwitchingContext';
import { isConnectDeferredForSession } from '../../lib/connectDeferredSession';
import { resolveAppGate, type PushGateStatus } from '../../lib/navigationGates';
import { resetToHomeRoot } from '../../lib/navigateAfterConnect';
import { theme } from '../../lib/theme';

function LoadingState({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

/**
 * Sprint 10 Phase 4 — leagues gate (zero → connect) then push catch-all (only when count >= 1
 * and on Home). Decisions live in `resolveAppGate` so ordering/async waits stay testable.
 */
function AppNavigator() {
  const { status: pushStatusRaw } = usePushPermission();
  const {
    status: leaguesStatus,
    leagueCount,
    errorMessage,
    refreshLeagues,
  } = useLeaguesGate();
  // Read the session module directly in the gate path so a Close → replace race cannot see a
  // stale React snapshot of connectDeferred (Bug 1). Context still owns deferConnect / re-renders.
  const connectDeferred = isConnectDeferredForSession();
  const segments = useSegments();
  const router = useRouter();
  const params = useGlobalSearchParams<{ onboarding?: string }>();
  const routeLeaf = segments[segments.length - 1] as string | undefined;
  const notificationsOnboarding =
    routeLeaf === 'notifications-permission' && params.onboarding === '1';

  const pushStatus = pushStatusRaw as PushGateStatus;

  const decision = resolveAppGate({
    leaguesStatus,
    leagueCount,
    connectDeferred,
    routeLeaf,
    pushStatus,
    notificationsOnboarding,
  });

  const decisionKey =
    decision.action === 'leave_notifications'
      ? `leave:${decision.destination}`
      : decision.action;

  useEffect(() => {
    switch (decision.action) {
      case 'redirect_connect':
        router.replace('/(app)/connect-team?onboarding=1');
        break;
      case 'redirect_notifications':
        router.replace('/(app)/notifications-permission');
        break;
      case 'leave_notifications':
        if (decision.destination === 'all-set') {
          router.replace('/(app)/onboarding-all-set');
        } else {
          resetToHomeRoot(router);
        }
        break;
      default:
        break;
    }
    // decisionKey collapses equivalent decisions so we don't re-replace every render.
  }, [decisionKey, decision, router]);

  if (decision.action === 'wait') {
    return <LoadingState message="Loading..." />;
  }

  if (decision.action === 'leagues_error') {
    return (
      <View style={styles.loadingContainer}>
        <ErrorState
          message={errorMessage ?? 'Could not load your leagues.'}
          onRetry={() => {
            void refreshLeagues();
          }}
        />
      </View>
    );
  }

  if (
    decision.action === 'redirect_connect' ||
    decision.action === 'redirect_notifications' ||
    decision.action === 'leave_notifications'
  ) {
    return <LoadingState message="Loading..." />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="notifications-permission" />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="connect-team" />
      <Stack.Screen name="edit-manual-lineup" />
      <Stack.Screen name="onboarding-streaming" />
      <Stack.Screen name="onboarding-all-set" />
    </Stack>
  );
}

export default function AppGroupLayout() {
  return (
    <PushPermissionProvider>
      <LeaguesGateProvider>
        <SwitchingProvider>
          <AppNavigator />
          <NotificationBannerHost />
          <NotificationResponseHandler />
        </SwitchingProvider>
      </LeaguesGateProvider>
    </PushPermissionProvider>
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
    fontSize: 16,
  },
});
