import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DESKTOP_RAIL_WIDTH,
  DESKTOP_SIDEBAR_WIDTH,
  type DesktopTier,
} from '../lib/desktopLayout';
import { fonts } from '../lib/fonts';
import { fetchMe } from '../lib/me';
import { theme } from '../lib/theme';
import { webPressState } from '../lib/webPress';

type NavKey = 'home' | 'lineup' | 'settings';

/**
 * Web sidebar. Wide shows labels and the Pro card. Medium is the same destinations as icons.
 * The iPhone does not mount this; it keeps `AppTabBar`.
 */
export function DesktopNav({
  tier,
  lineupLabel,
}: {
  tier: Exclude<DesktopTier, 'companion'>;
  lineupLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const wide = tier === 'wide';
  const active = activeKey(pathname);

  return (
    <View style={[styles.nav, wide ? styles.wide : styles.rail]}>
      <Text accessibilityRole="header" style={[styles.wordmark, wide && styles.wordmarkWide]}>
        {wide ? 'Pivot' : 'P'}
      </Text>
      <View style={styles.items}>
        <NavItem
          active={active === 'home'}
          icon="home"
          label="Home"
          wide={wide}
          onPress={() => router.replace('/')}
        />
        <NavItem
          active={active === 'lineup'}
          icon="watch"
          label={lineupLabel}
          wide={wide}
          onPress={() => router.replace('/lineup')}
        />
        <NavItem
          active={active === 'settings'}
          icon="settings"
          label="Settings"
          wide={wide}
          onPress={() => router.replace('/settings')}
        />
      </View>
      <View style={styles.spacer} />
      {wide ? <ProCard onPress={() => router.replace('/settings')} /> : null}
    </View>
  );
}

function activeKey(pathname: string): NavKey | null {
  if (pathname === '/lineup' || pathname.endsWith('/lineup')) return 'lineup';
  if (pathname === '/settings' || pathname.endsWith('/settings')) return 'settings';
  if (pathname === '/' || pathname.endsWith('/index')) return 'home';
  return null;
}

function NavItem({
  active,
  icon,
  label,
  wide,
  onPress,
}: {
  active: boolean;
  icon: 'home' | 'watch' | 'settings';
  label: string;
  wide: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered, focused } = webPressState(state);
        return [
          styles.item,
          wide && styles.itemWide,
          active && styles.itemActive,
          hovered && !active && styles.itemHover,
          pressed && styles.itemPressed,
          focused && styles.itemFocused,
        ];
      }}
    >
      <NavMark active={active} icon={icon} />
      {wide ? (
        <Text numberOfLines={1} style={[styles.itemLabel, active && styles.itemLabelActive]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

function NavMark({ active, icon }: { active: boolean; icon: 'home' | 'watch' | 'settings' }) {
  const color = active ? theme.colors.accent : theme.colors.textSecondary;
  if (icon === 'home') {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={[styles.gridCell, { backgroundColor: color }]} />
        ))}
      </View>
    );
  }
  if (icon === 'watch') {
    return (
      <View style={styles.bars}>
        <View style={[styles.bar, { backgroundColor: color, width: 16 }]} />
        <View style={[styles.bar, { backgroundColor: color, width: 12 }]} />
        <View style={[styles.bar, { backgroundColor: color, width: 8 }]} />
      </View>
    );
  }
  return <View style={[styles.ring, { borderColor: color }]} />;
}

function ProCard({ onPress }: { onPress: () => void }) {
  const [line, setLine] = useState('Upgrade in the iOS app');

  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (cancelled) return;
        setLine(me.subscription_tier === 'pro' ? "You're on Pro" : 'Upgrade in the iOS app');
      })
      .catch(() => {
        // The card stays a pointer to Settings. Account still loads there.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={(state) => {
        const { pressed, hovered, focused } = webPressState(state);
        return [
          styles.pro,
          hovered && styles.proHover,
          pressed && styles.proPressed,
          focused && styles.itemFocused,
        ];
      }}
    >
      <Text style={styles.proEyebrow}>PIVOT PRO</Text>
      <Text style={styles.proLine}>{line}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: theme.radii.pill,
    height: 2,
  },
  bars: {
    gap: 3,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    height: 16,
    width: 16,
  },
  gridCell: {
    borderRadius: 1,
    height: 7,
    width: 7,
  },
  item: {
    alignItems: 'center',
    borderRadius: theme.radii.control,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  itemActive: {
    backgroundColor: theme.colors.accentMuted,
  },
  itemFocused: {
    borderColor: theme.colors.accent,
    borderWidth: theme.effects.panelBorderWidth,
  },
  itemHover: {
    backgroundColor: theme.colors.surface,
  },
  itemLabel: {
    color: theme.colors.textSecondary,
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.body.size,
  },
  itemLabelActive: {
    color: theme.colors.accent,
  },
  itemPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  itemWide: {
    justifyContent: 'flex-start',
    paddingHorizontal: theme.spacing.md,
  },
  items: {
    gap: theme.spacing.xs,
  },
  nav: {
    backgroundColor: theme.colors.background,
    borderRightColor: theme.colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    height: '100%',
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.lg,
  },
  pro: {
    backgroundColor: theme.colors.emberSolid,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    cursor: 'pointer',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
  },
  proEyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  proHover: {
    backgroundColor: theme.colors.surface,
  },
  proLine: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  proPressed: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  rail: {
    width: DESKTOP_RAIL_WIDTH,
  },
  ring: {
    borderRadius: theme.radii.pill,
    borderWidth: 2,
    height: 14,
    width: 14,
  },
  spacer: {
    flex: 1,
  },
  wide: {
    justifyContent: 'flex-start',
    width: DESKTOP_SIDEBAR_WIDTH,
  },
  wordmark: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: 20,
    letterSpacing: -0.3,
    marginBottom: theme.spacing.xl,
    textAlign: 'center',
  },
  wordmarkWide: {
    paddingHorizontal: theme.spacing.md,
    textAlign: 'left',
  },
});
