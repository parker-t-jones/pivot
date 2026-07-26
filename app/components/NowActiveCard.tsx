import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  formatClock,
  quarterLabel,
  reasonLabel,
  serviceLabel,
  type CurrentFlag,
  type GameBroadcast,
} from '../lib/gameDisplay';
import { reasonChipCopy, resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../lib/teamDisplay';
import { theme } from '../lib/theme';

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
 * PLAN.md Section 10 Home State 1 "Now active" card (the dominant card): teams + score, game-state
 * strip, a reason chip, and the primary CTA ("Watch on {service}"). The CTA is disabled when there's
 * no resolvable broadcast/deep link, matching Section 10's graceful-degradation intent rather than
 * offering a button that leads nowhere.
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

      <Text style={styles.stateStrip}>
        {quarterLabel(game.quarter)} · {formatClock(game.time_remaining_sec)}
      </Text>

      {chipText ? (
        <View style={styles.reasonChip}>
          <Text style={styles.reasonChipText}>{chipText}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!canSwitch}
        onPress={onSwitch}
        style={[styles.cta, !canSwitch && styles.ctaDisabled]}
      >
        <Text style={[styles.ctaText, !canSwitch && styles.ctaTextDisabled]}>
          {canSwitch && broadcast
            ? `Watch on ${serviceLabel(broadcast.service)}`
            : 'No broadcast available'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    gap: 10,
    padding: 20,
    width: '100%',
  },
  cta: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.md,
    marginTop: theme.spacing.sm,
    paddingVertical: 15,
  },
  ctaDisabled: {
    backgroundColor: theme.colors.border,
  },
  ctaText: {
    color: theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  ctaTextDisabled: {
    color: theme.colors.textPrimary,
  },
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
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
    backgroundColor: 'rgba(255, 176, 32, 0.18)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
  },
  reasonChipText: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: '600',
  },
  score: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  stateStrip: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
  },
});
