import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FantasyLeagueCardModel } from '../lib/fantasyLeagueCard';
import { theme } from '../lib/theme';
import { TextButton } from './TextButton';

interface FantasyLeagueCardProps {
  model: FantasyLeagueCardModel;
  expanded: boolean;
  onToggle: () => void;
  /** Opens the Fantasy tab on this league. */
  onSeeFullLineup: () => void;
  /** The lineup, rendered only while expanded. Phone rows on iOS, a table on desktop web. */
  children: ReactNode;
}

/**
 * One fantasy league on the Watchlist's All tab (issue #14). Collapsed: platform eyebrow,
 * league name, and a starter summary. Tap expands the lineup in place.
 */
export function FantasyLeagueCard({
  model,
  expanded,
  onToggle,
  onSeeFullLineup,
  children,
}: FantasyLeagueCardProps) {
  return (
    <View style={styles.card} testID={`fantasy-league-card-${model.leagueId}`}>
      <Pressable
        accessibilityHint={expanded ? 'Hides the lineup.' : 'Shows the lineup.'}
        accessibilityLabel={`${model.name}, ${model.summary}`}
        accessibilityRole="button"
        aria-expanded={expanded}
        onPress={onToggle}
        style={styles.header}
        testID="fantasy-league-card-toggle"
      >
        <View style={styles.copy}>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.eyebrow}
          >
            {model.eyebrow}
          </Text>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.name}
          >
            {model.name}
          </Text>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.summary}
            testID="fantasy-league-card-summary"
          >
            {model.summary}
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          style={[styles.toggleLabel, expanded && styles.toggleLabelOpen]}
        >
          {expanded ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body} testID="fantasy-league-card-lineup">
          {children}
          <View style={styles.link}>
            <TextButton label="See full lineup" onPress={onSeeFullLineup} size="smallStrong" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  copy: {
    flex: 1,
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  link: {
    alignItems: 'flex-start',
  },
  name: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    lineHeight: theme.type.heading.lineHeight,
  },
  summary: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  toggleLabel: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
    lineHeight: theme.type.smallStrong.lineHeight,
  },
  toggleLabelOpen: {
    color: theme.colors.accent,
  },
});
