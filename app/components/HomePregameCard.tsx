import { StyleSheet, Text, View } from 'react-native';

import { UpcomingStakeGameList } from './UpcomingStakeGameList';
import { formatCountdown, type LineupGameGroup } from '../lib/homeState';
import { theme } from '../lib/theme';

interface HomePregameCardProps {
  /** Milliseconds until the next stake kickoff. */
  countdownMs: number;
  groups: LineupGameGroup[];
  week: number;
}

/**
 * PLAN.md Section 10 Home State 3 — countdown header + same upcoming-game cards as State 4.
 */
export function HomePregameCard({ countdownMs, groups, week }: HomePregameCardProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Pre-game</Text>
      <Text style={styles.heroTitle}>First flag in {formatCountdown(countdownMs)}</Text>
      <UpcomingStakeGameList
        games={groups}
        heading={`WEEK ${week} — Upcoming games:`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    marginBottom: theme.spacing.sm,
  },
  wrap: {
    gap: theme.spacing.xs,
    width: '100%',
  },
});
