import { StyleSheet, Text, View } from 'react-native';

import { seasonIdleCopy } from '../lib/homeState';
import { theme } from '../lib/theme';

interface IdleHomeCardProps {
  /** State 4a variant — 'off' and 'pre' stay distinct (see `resolveHomeBranch`). */
  variant: 'off' | 'pre';
  /** NFL season year string from `/state/nfl` (e.g. "2026"). */
  season: string;
  leagueCount: number;
  /** Schedule-derived openers from `/state/nfl` — never Sleeper `season_start_date`. */
  preseasonStart: string | null;
  regularSeasonStart: string | null;
}

/**
 * Home State 4a — offseason / preseason idle panel (Sprint 10 Phase 2).
 *
 * Same panel structure for 'off' and 'pre'; distinct copy via `seasonIdleCopy`. Opener dates come
 * from `preseason_start` / `regular_season_start` on `/state/nfl` (games rows, ET calendar day).
 * Do not render Sleeper's `season_start_date` (phase-relative — see PLAN Known Issues).
 */
export function IdleHomeCard({
  variant,
  season,
  leagueCount,
  preseasonStart,
  regularSeasonStart,
}: IdleHomeCardProps) {
  const copy = seasonIdleCopy(variant, season, leagueCount, {
    preseasonStart,
    regularSeasonStart,
  });

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{copy.heading}</Text>
      {copy.seasonLine ? <Text style={styles.heading}>{copy.seasonLine}</Text> : null}
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.divider} />
      <Text style={styles.leagueLine}>{copy.leagueLine}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  leagueLine: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.caption.weight,
  },
});
