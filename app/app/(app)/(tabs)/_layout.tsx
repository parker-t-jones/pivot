import { Tabs } from 'expo-router';

import { AppTabBar } from '../../../components/AppTabBar';
import { SHOW_BETS } from '../../../lib/featureFlags';
import { lineupScreenMode } from '../../../lib/watchlistFilter';

/**
 * PLAN.md §10 three-tab shell: Home · Lineup · Settings.
 * Connect / edit-lineup / onboarding stay on the parent `(app)` stack.
 * Fully custom bar (`AppTabBar`) — Home sits center as a fixed elevated circle (house glyph),
 * Lineup/Settings flank it as plain text. See `AppTabBar`'s docstring for the active-state rules.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen
        name="lineup"
        options={{ title: lineupScreenMode(SHOW_BETS) === 'watchlist' ? 'Watchlist' : 'Lineup' }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
