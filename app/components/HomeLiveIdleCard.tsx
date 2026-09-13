import { StyleSheet, Text, View } from 'react-native';

import type { LiveGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { FieldGauge } from './FieldGauge';

interface HomeLiveIdleCardProps {
  /** Stake games currently in progress (State 2). */
  liveGames: LiveGame[];
}

/**
 * PLAN.md Section 10 Home State 2 — live games, no flags right now.
 * Phase 3 will subscribe to the WebSocket flag stream and flip this into State 1 in place;
 * cold-start only for Phase 2 (leave that seam — do not build the WS client here).
 */
export function HomeLiveIdleCard({ liveGames }: HomeLiveIdleCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Your next flag is incoming</Text>
        <Text style={styles.heroBody}>
          Possession is changing — we&apos;ll surface a game the moment your players get active.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Your live games</Text>
      {liveGames.map((game) => {
        const opponentTeam =
          game.possession_team === null
            ? null
            : game.possession_team === game.home_team
              ? game.away_team
              : game.home_team;

        return (
          <View
            key={game.game_id}
            style={[styles.gameRow, game.possession_team !== null && styles.gameRowActive]}
          >
            <View style={styles.matchupRow}>
              <Text style={styles.matchup}>
                {game.away_team} @ {game.home_team}
              </Text>
              <Text style={styles.score}>
                {game.score.away}–{game.score.home}
              </Text>
            </View>
            <FieldGauge
              yardsToEndzone={game.yards_to_endzone}
              possessionTeam={game.possession_team}
              opponentTeam={opponentTeam}
              down={game.down}
              distance={game.distance}
              quarter={game.quarter}
              timeRemainingSec={game.time_remaining_sec}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gameRow: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  /** The row whose team currently has the ball (UI-SPEC.md §3.3) — not every row. */
  gameRowActive: {
    borderColor: theme.colors.accentBorder,
    borderWidth: theme.effects.panelBorderWidth,
    ...theme.effects.panelGlow,
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
    flexShrink: 1,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  score: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
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
