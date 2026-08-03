import { StyleSheet, Text, View } from 'react-native';

import { formatNextGameWhen } from '../lib/homeState';
import type { ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';

interface HomeOffDayCardProps {
  nextGame: ScheduleGame | null;
  playerCount: number;
  week: number;
}

/**
 * PLAN.md Section 10 Home State 4 — in-season off-day preview.
 */
export function HomeOffDayCard({ nextGame, playerCount, week }: HomeOffDayCardProps) {
  const playerLabel =
    playerCount === 1 ? 'your players in it: 1' : `your players in it: ${playerCount}`;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Week {week}</Text>
      {nextGame ? (
        <>
          <Text style={styles.heading}>
            Next game: {formatNextGameWhen(nextGame.scheduled_start)}
          </Text>
          <Text style={styles.matchup}>
            {nextGame.away_team} @ {nextGame.home_team}
          </Text>
          <Text style={styles.body}>{playerLabel}</Text>
        </>
      ) : (
        <>
          <Text style={styles.heading}>No upcoming games this week</Text>
          <Text style={styles.body}>
            We&apos;ll surface your slate as soon as the next kickoff is on the schedule.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: 21,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    width: '100%',
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heading: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  matchup: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
});
