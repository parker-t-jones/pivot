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
        <Text style={styles.ctaText}>
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
    backgroundColor: '#1c1c1e',
    borderRadius: 20,
    gap: 10,
    padding: 20,
    width: '100%',
  },
  cta: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 12,
    marginTop: 8,
    paddingVertical: 15,
  },
  ctaDisabled: {
    backgroundColor: '#3a3a3c',
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  matchup: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reasonChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(31, 111, 235, 0.18)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reasonChipText: {
    color: '#5aa2ff',
    fontSize: 13,
    fontWeight: '600',
  },
  score: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  stateStrip: {
    color: '#c7c7cc',
    fontSize: 15,
  },
});
