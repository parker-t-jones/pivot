import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

/**
 * Derived from `<Tabs>`'s own `tabBar` prop type rather than hand-declared or deep-imported from
 * `expo-router`'s vendored `react-navigation` build — guarantees this always matches whatever
 * `BottomTabBarProps` shape `<Tabs tabBar={(props) => <AppTabBar {...props} />}>` actually passes.
 */
type AppTabBarProps = NonNullable<ComponentProps<typeof Tabs>['tabBar']> extends (
  props: infer P,
) => unknown
  ? P
  : never;

/**
 * Custom three-tab bar — Lineup · Home · Settings, all plain text. Docked full-width bar (not
 * floating) — react-navigation reserves screen content space above it automatically, same as the
 * default tab bar would. Selected state is amber tint; unselected is gray, same as the label.
 */
export function AppTabBar({ state, navigation, insets }: AppTabBarProps) {
  const routesByName = new Map(state.routes.map((route, index) => [route.name, { route, index }]));

  const isFocused = (name: string) => routesByName.get(name)?.index === state.index;

  const go = (name: string) => {
    const entry = routesByName.get(name);
    if (!entry) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: entry.route.key,
      canPreventDefault: true,
    });
    if (!isFocused(name) && !event.defaultPrevented) {
      navigation.navigate(entry.route.name);
    }
  };

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom || theme.spacing.sm }]}>
      <SideTab active={isFocused('lineup')} label="Lineup" onPress={() => go('lineup')} />
      <SideTab active={isFocused('index')} label="Home" onPress={() => go('index')} />
      <SideTab active={isFocused('settings')} label="Settings" onPress={() => go('settings')} />
    </View>
  );
}

function SideTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.sideTab}
    >
      <Text style={[styles.sideLabel, active && styles.sideLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingTop: theme.spacing.sm,
  },
  sideTab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
  },
  sideLabel: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoBold,
    fontSize: 13,
    fontWeight: '400',
  },
  sideLabelActive: {
    color: theme.colors.accent,
  },
});
