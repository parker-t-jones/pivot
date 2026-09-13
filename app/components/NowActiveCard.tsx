import { StyleSheet, Text, View } from 'react-native';

import {
  reasonLabel,
  serviceLabel,
  type CurrentFlag,
  type GameBroadcast,
} from '../lib/gameDisplay';
import { reasonChipCopy, resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../lib/teamDisplay';
import { theme } from '../lib/theme';
import { FieldGauge } from './FieldGauge';
import { PrimaryButton } from './PrimaryButton';

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
 * PLAN.md Section 10 Home State 1 "Now active" card (the dominant card): teams + score, field
 * gauge (UI-SPEC.md §3.1), a reason chip, and the primary CTA ("Watch on {service}"). The CTA is
 * disabled when there's no resolvable broadcast/deep link, matching Section 10's
 * graceful-degradation intent rather than offering a button that leads nowhere. The outer card
 * always carries the `accentBorder` stroke + `panelGlow` (UI-SPEC.md §2.3/§3.3) — it only renders
 * for an active flag, so there's no "possession" condition to gate it on.
 *
 * Sprint 9 Phase 2: the reason chip now renders the Section 10 fidelity target — player name(s),
 * position, and team+unit ("Jonathan Taylor active — RB — Colts offense") — using Phase 1's
 * `flagged_players` plus `playerTeamMap` for the team portion. Falls back to the plain reason-type
 * label (`reasonLabel`) only if there are no flagged players on this flag at all (shouldn't happen
 * in practice — every flag has at least one triggering player — but is a real possibility the type
 * system allows for).
 */
export function NowActiveCard({ flag, broadcast, playerTeamMap, onSwitch }: NowActiveCardProps) {
  const { game } = flag;
  const canSwitch = broadcast !== null && broadcast.deep_link_url.length > 0;
  const primaryReason = flag.reasons[0];
  const flaggedTeam = resolveFlaggedTeamDisplay(game, flag.flagged_players, playerTeamMap);
  const chipText =
    primaryReason && flag.flagged_players.length > 0
      ? reasonChipCopy(primaryReason, flag.flagged_players, flaggedTeam)
      : primaryReason
        ? reasonLabel(primaryReason)
        : null;

  const opponentTeam =
    game.possession_team === null
      ? null
      : game.possession_team === game.home_team
        ? game.away_team
        : game.home_team;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Now active</Text>

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

      {chipText ? (
        <View style={styles.reasonChip}>
          <Text style={styles.reasonChipText}>{chipText}</Text>
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
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
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  matchup: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reasonChip: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentMuted,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  reasonChipText: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  score: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.score.size,
    fontWeight: theme.type.score.weight,
    lineHeight: theme.type.score.lineHeight,
  },
});
