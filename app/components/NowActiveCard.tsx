import { StyleSheet, Text, View } from 'react-native';

import {
  fieldAlignedMatchup,
  hexWithAlpha,
  opponentAbbreviation,
  reasonLabel,
  serviceLabel,
  type CurrentFlag,
  type GameBroadcast,
} from '../lib/gameDisplay';
import { fonts } from '../lib/fonts';
import { reasonChipParts, resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../lib/teamDisplay';
import { theme } from '../lib/theme';
import { FieldGauge } from './FieldGauge';
import { PrimaryButton } from './PrimaryButton';

/** Semi-transparent team primary wash behind each side (nickname + score). */
const TEAM_NAME_WASH_ALPHA = 0.32;
interface NowActiveCardProps {
  flag: CurrentFlag;
  /** The preferred broadcast to route to, or null when none resolved (deep-link degradation). */
  broadcast: GameBroadcast | null;
  /** `player_id -> team` map built from the caller's own lineup fetch (see `lib/leagues.ts`) — the
   *  only source of "which team does this flagged player play for" (see `teamDisplay.ts`'s
   *  docstring on why `flagged_players` alone can't answer that). */
  playerTeamMap: PlayerTeamMap;
  onSwitch: () => void;
}

/**
 * PLAN.md Section 10 Home State 1 "Now active" card: field-aligned team names + centered split
 * score, numbered field gauge (UI-SPEC.md §3.1), outlined reason chip with amber wash, and the
 * primary CTA (`Watch on {preferred service}`). CTA disabled when no resolvable broadcast.
 * Card uses `accentBorder` + `panelGlow` and `colors.background` (same as Home canvas).
 */
export function NowActiveCard({ flag, broadcast, playerTeamMap, onSwitch }: NowActiveCardProps) {
  const { game } = flag;
  const canSwitch = broadcast !== null && broadcast.deep_link_url.length > 0;
  const primaryReason = flag.reasons[0];
  const flaggedTeam = resolveFlaggedTeamDisplay(game, flag.flagged_players, playerTeamMap);
  const chipParts =
    primaryReason && flag.flagged_players.length > 0
      ? reasonChipParts(primaryReason, flag.flagged_players, flaggedTeam)
      : primaryReason
        ? { players: reasonLabel(primaryReason), team: null as string | null }
        : null;

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
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Now active</Text>

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

      {chipParts ? (
        <View style={styles.reasonChip}>
          <View style={styles.reasonChipPlayers}>
            <Text style={styles.reasonChipText} numberOfLines={1}>
              {chipParts.players}
            </Text>
          </View>
          {chipParts.team ? (
            <>
              <View style={styles.reasonChipDivider} />
              <View style={styles.reasonChipTeam}>
                <Text style={[styles.reasonChipText, styles.reasonChipTeamText]} numberOfLines={1}>
                  {chipParts.team}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      <PrimaryButton
        inactive={!canSwitch}
        label={
          canSwitch && broadcast
            ? `Watch on ${serviceLabel(broadcast.service)}`
            : 'No broadcast available'
        }
        onPress={onSwitch}
        style={styles.cta}
        labelStyle={styles.ctaLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.hero,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg2,
    width: '100%',
    ...theme.effects.panelGlow,
  },
  cta: {
    marginTop: theme.spacing.sm,
  },
  ctaLabel: {
    // Face is already Bold — drop recipe weight so RN doesn't skip Space Grotesk.
    fontFamily: fonts.teamNickname,
    fontWeight: '400',
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  reasonChip: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    overflow: 'hidden',
    paddingVertical: theme.spacing.sm,
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  /** ~3/4 of the pill — player active copy. */
  reasonChipPlayers: {
    flex: 3,
    paddingHorizontal: theme.spacing.md,
  },
  reasonChipDivider: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.accent,
    opacity: 0.55,
    width: StyleSheet.hairlineWidth * 2,
  },
  /** ~1/4 of the pill — team nickname. */
  reasonChipTeam: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  reasonChipTeamText: {
    textAlign: 'center',
  },
  reasonChipText: {
    color: theme.colors.accent,
    fontFamily: fonts.monoSemiBold,
    fontSize: theme.type.caption.size,
    fontWeight: '600',
  },
  score: {
    color: theme.colors.textPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: theme.type.score.size,
    fontVariant: [...theme.type.score.fontVariant],
    letterSpacing: theme.type.score.letterSpacing,
    lineHeight: theme.type.score.lineHeight,
    minWidth: 28,
    textAlign: 'center',
  },
  scoreDivider: {
    backgroundColor: theme.colors.border,
    height: 22,
    marginHorizontal: theme.spacing.xs,
    width: StyleSheet.hairlineWidth * 2,
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
    fontSize: 22,
    letterSpacing: -0.5,
  },
  teamRight: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
