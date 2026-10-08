import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

interface HomeDashboardProps {
  /** Optional trailing header control — omitted when Settings lives in the tab bar. */
  headerRight?: ReactNode;
  /** Mode eyebrow above the "Home" title (live Home only). */
  eyebrow?: ReactNode;
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
  eyebrow,
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
      {eyebrow}
      <View style={styles.headerRow}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.title}>
          Home
        </Text>
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
    rowGap: theme.spacing.xs,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  title: {
    color: theme.colors.textPrimary,
    flexShrink: 0,
    // Same JetBrains Mono bold as the Now Active eyebrow (type trial).
    fontFamily: fonts.monoBold,
    fontSize: theme.type.title.size,
    letterSpacing: theme.type.title.letterSpacing,
  },
});
