import { StyleSheet, Text, View } from 'react-native';

import { fieldAlignedMatchup, hexWithAlpha, opponentAbbreviation } from '../lib/gameDisplay';
import { fonts } from '../lib/fonts';
import type { LiveGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { FieldGauge } from './FieldGauge';

/** Semi-transparent team primary wash behind each side (nickname + score) — same treatment as
 *  `NowActiveCard`'s "Now active" scoreboard (UI-SPEC.md §2.4), scaled down for a list row. */
const TEAM_NAME_WASH_ALPHA = 0.32;

interface HomeLiveIdleCardProps {
  /** Stake games currently in progress (State 2). */
  liveGames: LiveGame[];
}

/**
 * PLAN.md Section 10 Home State 2 — live games, no flags right now. Each row gets the same
 * field-aligned scoreboard treatment as `NowActiveCard` (team-color washes, split score divider)
 * so the card doesn't regress to a plain "@" matchup line the moment a flag clears.
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
        const opponentTeam = opponentAbbreviation(
          game.possession_team,
          game.home_team,
          game.away_team,
        );
        const matchup = fieldAlignedMatchup(game);
        const leftWash =
          hexWithAlpha(matchup.leftPrimaryColor, TEAM_NAME_WASH_ALPHA) ?? theme.colors.surface;
        const rightWash =
          hexWithAlpha(matchup.rightPrimaryColor, TEAM_NAME_WASH_ALPHA) ?? theme.colors.surface;

        return (
          <View
            key={game.game_id}
            style={[styles.gameRow, game.possession_team !== null && styles.gameRowActive]}
          >
            <View style={styles.matchupRow}>
              <View style={[styles.sideChip, styles.sideChipLeft, { backgroundColor: leftWash }]}>
                <Text style={[styles.teamName, styles.teamLeft]} numberOfLines={1}>
                  {matchup.leftName}
                </Text>
                <Text style={styles.score}>{matchup.leftScore}</Text>
              </View>
              <View style={styles.scoreDivider} />
              <View style={[styles.sideChip, styles.sideChipRight, { backgroundColor: rightWash }]}>
                <Text style={styles.score}>{matchup.rightScore}</Text>
                <Text style={[styles.teamName, styles.teamRight]} numberOfLines={1}>
                  {matchup.rightName}
                </Text>
              </View>
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
    gap: theme.spacing.sm,
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
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  score: {
    color: theme.colors.textPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: theme.type.score.size,
    fontVariant: [...theme.type.score.fontVariant],
    letterSpacing: theme.type.score.letterSpacing,
    lineHeight: theme.type.score.lineHeight,
    minWidth: 24,
    textAlign: 'center',
  },
  scoreDivider: {
    backgroundColor: theme.colors.border,
    height: 20,
    marginHorizontal: theme.spacing.xs,
    width: StyleSheet.hairlineWidth * 2,
  },
  sectionLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: 0.3,
    marginTop: theme.spacing.sm,
    textTransform: 'uppercase',
  },
  sideChip: {
    alignItems: 'center',
    borderRadius: theme.radii.sm,
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  sideChipLeft: {
    justifyContent: 'space-between',
  },
  sideChipRight: {
    justifyContent: 'space-between',
  },
  teamLeft: {
    flexShrink: 1,
    textAlign: 'left',
  },
  teamName: {
    color: theme.colors.textPrimary,
    // Weight is baked into the face — don't also set fontWeight '700' or RN may skip the custom font.
    fontFamily: fonts.sansBold,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  teamRight: {
    flexShrink: 1,
    textAlign: 'right',
  },
  wrap: {
    gap: theme.spacing.md,
    width: '100%',
  },
});
