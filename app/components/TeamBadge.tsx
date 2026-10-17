import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { badgeColors, teamName } from '../lib/teamColors';
import { theme } from '../lib/theme';

export type TeamBadgeSize = 'sm' | 'md' | 'lg';

interface TeamBadgeProps {
  abbr: string;
  size: TeamBadgeSize;
  style?: StyleProp<ViewStyle>;
}

const SIZE_BOX = {
  sm: theme.spacing.xxl,
  md: theme.spacing.xxxl,
  lg: theme.spacing.huge,
} as const;

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    borderWidth: theme.effects.panelBorderWidth,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    textAlign: 'center',
  },
  smBox: { height: SIZE_BOX.sm, width: SIZE_BOX.sm },
  mdBox: { height: SIZE_BOX.md, width: SIZE_BOX.md },
  lgBox: { height: SIZE_BOX.lg, width: SIZE_BOX.lg },
  smType: {
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
  },
  mdType: {
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  lgType: {
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
});

const BOX = { sm: styles.smBox, md: styles.mdBox, lg: styles.lgBox } as const;
const TYPE = { sm: styles.smType, md: styles.mdType, lg: styles.lgType } as const;

function shownAbbreviation(abbr: string): string {
  if (typeof abbr !== 'string') return '';
  return abbr.trim().toUpperCase();
}

/**
 * Initials on the team primary, with a thin secondary ring. Not mounted by any screen yet.
 * React Native primitives, so the same component runs on iOS and web.
 */
export function TeamBadge({ abbr, size, style }: TeamBadgeProps) {
  const abbreviation = shownAbbreviation(abbr);
  const colors = badgeColors(abbreviation);
  const label = teamName(abbreviation) ?? abbreviation;

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="image"
      accessible
      style={[
        styles.badge,
        BOX[size],
        { backgroundColor: colors.fill, borderColor: colors.border },
        style,
      ]}
    >
      <Text
        accessibilityElementsHidden
        adjustsFontSizeToFit
        importantForAccessibility="no-hide-descendants"
        numberOfLines={1}
        style={[styles.initials, TYPE[size], { color: colors.textColor }]}
      >
        {abbreviation}
      </Text>
    </View>
  );
}
