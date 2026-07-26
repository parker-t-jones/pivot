import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';

interface IdleHomeCardProps {
  lineupPlayerCount: number;
}

/**
 * Home idle state (leagues connected, no current flag). Dedicated to this branch so the shared
 * EmptyState stays available for State 5 / Settings / connect-team without picking up idle styling.
 */
export function IdleHomeCard({ lineupPlayerCount }: IdleHomeCardProps) {
  const playerLabel =
    lineupPlayerCount === 1
      ? '1 player in your lineup this week'
      : `${lineupPlayerCount} players in your lineup this week`;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.bellIcon} accessibilityLabel="Notifications">
          <View style={styles.bellBody} />
          <View style={styles.bellClapper} />
        </View>
        <Text style={styles.heading}>No flags right now</Text>
      </View>

      <Text style={styles.body}>We&apos;ll surface a game the moment your players get active.</Text>

      {lineupPlayerCount > 0 ? (
        <>
          <View style={styles.divider} />
          <View style={styles.lineupRow}>
            <View style={styles.rosterIcon} accessibilityLabel="Lineup">
              <View style={styles.rosterDot} />
              <View style={[styles.rosterDot, styles.rosterDotMid]} />
              <View style={styles.rosterDot} />
            </View>
            <Text style={styles.lineupText}>{playerLabel}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bellBody: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    height: 14,
    width: 14,
  },
  bellClapper: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    height: 4,
    marginTop: 2,
    width: 4,
  },
  bellIcon: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.body.weight,
    lineHeight: 21,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    width: '100%',
  },
  divider: {
    backgroundColor: theme.colors.border,
    height: 1,
    marginVertical: theme.spacing.xs,
    width: '100%',
  },
  heading: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  lineupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  lineupText: {
    color: theme.colors.textSecondary,
    flexShrink: 1,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.caption.weight,
  },
  rosterDot: {
    backgroundColor: theme.colors.textTertiary,
    borderRadius: theme.radii.pill,
    height: 5,
    width: 5,
  },
  rosterDotMid: {
    marginHorizontal: 1,
  },
  rosterIcon: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 16,
    justifyContent: 'center',
    width: 18,
  },
});
