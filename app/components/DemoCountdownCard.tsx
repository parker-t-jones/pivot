import { StyleSheet, Text, View } from 'react-native';

import { DEMO_AWAY_TEAM, DEMO_HOME_TEAM } from '../lib/demoGameDay';
import { formatClock } from '../lib/gameDisplay';
import { theme } from '../lib/theme';
import { TeamBadge } from './TeamBadge';

interface DemoCountdownCardProps {
  /** Whole seconds until the demo game goes live. */
  secondsLeft: number;
}

/**
 * Pre-game card of the demo game day (issue #66, from the approved #44 mockup): a quiet well card
 * with the countdown as the one big number. Local-only, fictional teams only.
 */
export function DemoCountdownCard({ secondsLeft }: DemoCountdownCardProps) {
  const seconds = Math.max(secondsLeft, 0);
  return (
    <View style={styles.card} testID="demo-countdown-card">
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
        DEMO · KICKOFF IN
      </Text>
      <Text
        accessibilityLabel={`Kickoff in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        numberOfLines={1}
        style={styles.countdown}
        testID="demo-countdown"
      >
        {formatClock(seconds)}
      </Text>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.sub}>
        Pivot is watching for your picks
      </Text>
      <View style={styles.matchup}>
        <TeamBadge abbr={DEMO_AWAY_TEAM.abbr} size="lg" />
        <Text style={styles.at}>at</Text>
        <TeamBadge abbr={DEMO_HOME_TEAM.abbr} size="lg" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  at: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.small.size,
  },
  card: {
    alignItems: 'center',
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.hero,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg2,
    paddingVertical: theme.spacing.xxl,
    width: '100%',
  },
  countdown: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.countdown.fontFamily,
    fontSize: theme.type.countdown.size,
    fontVariant: [...theme.type.countdown.fontVariant],
    fontWeight: theme.type.countdown.weight,
    letterSpacing: theme.type.countdown.letterSpacing,
    lineHeight: theme.type.countdown.lineHeight,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  matchup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  sub: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
    textAlign: 'center',
  },
});
