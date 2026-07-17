import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NowActiveCard } from '../../components/NowActiveCard';
import { useSession } from '../../contexts/SessionContext';
import { useSwitching } from '../../contexts/SwitchingContext';
import { ApiRequestError, apiClient } from '../../lib/apiClient';
import { scheduleTestFlagNotificationAsync } from '../../lib/devNotifications';
import {
  pickPreferredBroadcast,
  type CurrentFlag,
  type FlagsCurrentResponse,
  type GameBroadcast,
  type GameBroadcastsResponse,
} from '../../lib/gameDisplay';
import { supabase } from '../../lib/supabase';
import { unregisterPushNotificationsAsync } from '../../lib/pushNotifications';

interface HomeData {
  flag: CurrentFlag;
  broadcast: GameBroadcast | null;
}

export default function HomeScreen() {
  const { user } = useSession();
  const { switchToGame } = useSwitching();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<HomeData | null>(null);

  /**
   * Section 10 State 1 data path: `/flags/current` gives the top-priority flagged game (already
   * sorted server-side); `/games/:id/broadcasts` gives the preferred broadcast to route to. Both are
   * cold-start reads — live deltas over WebSocket are a later concern (no client socket yet).
   */
  const loadHome = useCallback(async () => {
    setLoadError(null);
    try {
      const { flags } = await apiClient.get<FlagsCurrentResponse>('/flags/current');
      const topFlag = flags[0];
      if (!topFlag) {
        setHomeData(null);
        return;
      }

      let broadcast: GameBroadcast | null = null;
      try {
        const { broadcasts } = await apiClient.get<GameBroadcastsResponse>(
          `/games/${topFlag.game_id}/broadcasts`,
        );
        broadcast = pickPreferredBroadcast(broadcasts);
      } catch (error) {
        // A broadcast-lookup failure shouldn't hide the flagged game — render the card with a
        // disabled CTA (Section 10 graceful degradation) rather than an error screen.
        console.warn('[home] failed to load broadcasts', error);
      }

      setHomeData({ flag: topFlag, broadcast });
    } catch (error) {
      const message =
        error instanceof ApiRequestError ? error.message : 'Could not load your games.';
      setLoadError(message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void loadHome().finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadHome]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadHome();
    setIsRefreshing(false);
  }, [loadHome]);

  const onSwitch = useCallback(() => {
    if (!homeData) return;
    const { flag, broadcast } = homeData;
    switchToGame({
      gameId: flag.game_id,
      deepLinkUrl: broadcast?.deep_link_url ?? null,
      label: `${flag.game.away_team} @ ${flag.game.home_team}`,
    });
  }, [homeData, switchToGame]);

  const onTestNotifications = async () => {
    setIsSendingTestNotification(true);
    try {
      await scheduleTestFlagNotificationAsync();
    } finally {
      setIsSendingTestNotification(false);
    }
  };

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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      <Text style={styles.title}>Home</Text>

      {isLoading ? (
        <View style={styles.centerBlock}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.mutedText}>Pulling up today&apos;s games…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centerBlock}>
          <Text style={styles.error}>{loadError}</Text>
          <Pressable onPress={onRefresh} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : homeData ? (
        <NowActiveCard flag={homeData.flag} broadcast={homeData.broadcast} onSwitch={onSwitch} />
      ) : (
        <View style={styles.centerBlock}>
          <Text style={styles.mutedText}>No games are flagged right now.</Text>
          <Text style={styles.mutedSubtext}>We&apos;ll surface one the moment your players get active.</Text>
        </View>
      )}

      <View style={styles.accountBlock}>
        <Text style={styles.mutedSubtext}>Signed in as {user?.email ?? 'unknown'}</Text>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable disabled={isSigningOut} onPress={onSignOut} style={styles.signOutButton}>
          {isSigningOut ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.signOutButtonText}>Sign out</Text>
          )}
        </Pressable>

        <Pressable disabled={isSendingTestNotification} onPress={onTestNotifications}>
          <Text style={styles.testNotificationsLink}>
            {isSendingTestNotification ? 'Sending in 2s…' : 'Test notifications'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  accountBlock: {
    alignItems: 'center',
    borderTopColor: '#2c2c2e',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginTop: 32,
    paddingTop: 24,
  },
  centerBlock: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 48,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
  },
  mutedSubtext: {
    color: '#8e8e93',
    fontSize: 13,
    textAlign: 'center',
  },
  mutedText: {
    color: '#c7c7cc',
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  screen: {
    backgroundColor: '#000',
    flex: 1,
  },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    minWidth: 150,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  signOutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  testNotificationsLink: {
    color: '#8e8e93',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
});
