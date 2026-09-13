import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';

interface HomeDashboardProps {
  headerRight: ReactNode;
  children: ReactNode;
  contentTopInset: number;
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * UI-SPEC.md §6: layout chrome pulled out of `HomeScreen` (`app/app/(app)/index.tsx`) — the
 * screen background, header row, and pull-to-refresh scroll container. Deliberately doesn't touch
 * data fetching, WebSocket wiring, or `resolveHomeBranch`; `HomeScreen` still owns `load`,
 * `renderBody`, and `useHomeRealtime`, and passes the rendered branch in as `children`.
 */
export function HomeDashboard({
  headerRight,
  children,
  contentTopInset,
  refreshing,
  onRefresh,
}: HomeDashboardProps) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: contentTopInset }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.textPrimary}
        />
      }
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Home</Text>
        {headerRight}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing.lg2,
    paddingVertical: theme.spacing.xl,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
