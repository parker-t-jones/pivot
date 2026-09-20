import { StyleSheet, Text, View } from 'react-native';

import {
  formatNextGameWhen,
  formatPlayersActiveInGame,
  type LineupGameGroup,
} from '../lib/homeState';
import { theme } from '../lib/theme';

interface UpcomingStakeGameListProps {
  games: LineupGameGroup[];
  /** Amber section eyebrow above the cards (e.g. "WEEK 2 — Upcoming games:"). */
  heading: string;
  emptyMessage?: string;
}

/**
 * Shared State 3 / State 4 stake-game slate — amber-bordered cards with kickoff,
 * AWAY | HOME, and Active Players (starter/flex only).
 */
export function UpcomingStakeGameList({
  games,
  heading,
  emptyMessage = "We'll surface your slate as soon as the next kickoff is on the schedule.",
}: UpcomingStakeGameListProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{heading}</Text>
      {games.length > 0 ? (
        games.map((group) => (
          <View key={group.game.game_id} style={styles.gameCard}>
            <Text style={styles.kickoff}>{formatNextGameWhen(group.game.scheduled_start)}</Text>
            <Text style={styles.matchup}>
              {group.game.away_team} | {group.game.home_team}
            </Text>
            <Text style={styles.body}>{formatPlayersActiveInGame(group.players)}</Text>
          </View>
        ))
      ) : (
        <View style={styles.gameCard}>
          <Text style={styles.body}>{emptyMessage}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  gameCard: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    width: '100%',
    ...theme.effects.panelGlow,
  },
  heading: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginBottom: theme.spacing.xs,
    textTransform: 'uppercase',
  },
  kickoff: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  matchup: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
  wrap: {
    gap: theme.spacing.sm,
    width: '100%',
  },
});
