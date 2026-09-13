import { StyleSheet, Text, View } from 'react-native';

import { formatCountdown, type LineupGameGroup } from '../lib/homeState';
import { theme } from '../lib/theme';

interface HomePregameCardProps {
  /** Milliseconds until the next stake kickoff. */
  countdownMs: number;
  groups: LineupGameGroup[];
}

/**
 * PLAN.md Section 10 Home State 3 — pre-game countdown + lineup grouped by kickoff.
 */
export function HomePregameCard({ countdownMs, groups }: HomePregameCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Pre-game</Text>
        <Text style={styles.heroTitle}>First flag in {formatCountdown(countdownMs)}</Text>
        <Text style={styles.heroBody}>
          We&apos;ll notify you the moment your players get active.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Your lineup by game</Text>
      {groups.map((group) => (
        <View key={group.game.game_id} style={styles.gameBlock}>
          <Text style={styles.matchup}>
            {group.game.away_team} @ {group.game.home_team}
          </Text>
          {group.players.map((player) => (
            <Text key={player.player_id} style={styles.playerRow}>
              {player.first_name} {player.last_name} · {player.position} ·{' '}
              {player.team_abbreviation}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  gameBlock: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  hero: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  heroBody: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  heroTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  matchup: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
    marginBottom: theme.spacing.xs,
  },
  playerRow: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  sectionLabel: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: 0.3,
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  wrap: {
    gap: theme.spacing.md,
    width: '100%',
  },
});
