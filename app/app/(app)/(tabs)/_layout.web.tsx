import { Tabs } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { AddPickDrawer } from '../../../components/AddPickDrawer';
import { AppTabBar } from '../../../components/AppTabBar';
import { DesktopNav } from '../../../components/DesktopNav';
import { closeAddPick, getAddPickOpen, subscribeAddPick } from '../../../lib/addPickDrawer';
import { DESKTOP_MAX_WIDTH } from '../../../lib/desktopLayout';
import { theme } from '../../../lib/theme';
import { useDesktopTier } from '../../../lib/useDesktopTier';
import { useFeature } from '../../../lib/useFeature';
import { lineupScreenMode } from '../../../lib/watchlistFilter';

/**
 * Web shell. Under 900px the phone tab bar and a single column stay, so a window snapped
 * beside a broadcast is still the phone screen. Wider windows get a left nav and a 1440px frame.
 * iOS uses `_layout.tsx` and never loads this file.
 */
export default function TabsLayout() {
  const betsOn = useFeature('bets');
  const tier = useDesktopTier();
  const desktop = tier !== 'companion';
  const lineupTitle = lineupScreenMode(betsOn) === 'watchlist' ? 'Watchlist' : 'Lineup';
  const addPickOpen = useSyncExternalStore(subscribeAddPick, getAddPickOpen, getAddPickOpen);

  useEffect(() => {
    if (tier !== 'wide' && addPickOpen) closeAddPick();
  }, [addPickOpen, tier]);

  return (
    <View style={styles.stage}>
      <View style={styles.frame}>
        {desktop ? <DesktopNav lineupLabel={lineupTitle} tier={tier} /> : null}
        <View style={styles.scene}>
          <Tabs
            screenOptions={{ headerShown: false }}
            tabBar={(props) => (desktop ? null : <AppTabBar {...props} />)}
          >
            <Tabs.Screen name="index" options={{ title: 'Home' }} />
            <Tabs.Screen name="lineup" options={{ title: lineupTitle }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
          </Tabs>
          {tier === 'wide' && addPickOpen ? <AddPickDrawer /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    flexDirection: 'row',
    maxWidth: DESKTOP_MAX_WIDTH,
    width: '100%',
  },
  scene: {
    flex: 1,
    minWidth: 0,
  },
  stage: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    overflow: 'hidden',
    width: '100%',
  },
});
