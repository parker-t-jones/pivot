import { StyleSheet, Text, View } from 'react-native';

import {
  downDistanceLabel,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
  fieldPositionLabel,
  formatClock,
  quarterLabel,
} from '../lib/gameDisplay';
import { theme } from '../lib/theme';

export interface FieldGaugeProps {
  yardsToEndzone: number | null;
  possessionTeam: string | null;
  /** Abbreviation of the team opposite possession (for opponent-territory labels). */
  opponentTeam: string | null;
  down: number | null;
  distance: number | null;
  quarter: number;
  timeRemainingSec: number;
}

/**
 * UI-SPEC.md §3.1 linear field gauge — thin 100-yard track with possession marker, optional
 * red-zone highlight, and down/distance + field-position labels. Renders nothing when
 * `yardsToEndzone` is null (omit-not-degrade: no possession / kickoff / timeout).
 */
export function FieldGauge({
  yardsToEndzone,
  possessionTeam,
  opponentTeam,
  down,
  distance,
  quarter,
  timeRemainingSec,
}: FieldGaugeProps) {
  if (yardsToEndzone === null) return null;

  const markerPercent = fieldGaugeMarkerPercent(yardsToEndzone);
  const showRedZone = fieldGaugeShowsRedZone(yardsToEndzone);
  const position = fieldPositionLabel(yardsToEndzone, possessionTeam, opponentTeam);
  const downDistance = downDistanceLabel(down, distance);

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {showRedZone ? <View style={styles.redZone} /> : null}
        <View style={[styles.marker, { left: `${markerPercent}%` }]} />
      </View>
      <View style={styles.labels}>
        <Text style={styles.ticker}>{position ?? '—'}</Text>
        <Text style={styles.ticker}>
          {quarterLabel(quarter)} · {formatClock(timeRemainingSec)}
          {downDistance ? ` · ${downDistance}` : ''}
        </Text>
      </View>
    </View>
  );
}

const TRACK_HEIGHT = 6;
const MARKER_SIZE = 10;

const styles = StyleSheet.create({
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  marker: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    height: MARKER_SIZE,
    marginLeft: -MARKER_SIZE / 2,
    position: 'absolute',
    top: (TRACK_HEIGHT - MARKER_SIZE) / 2,
    width: MARKER_SIZE,
  },
  redZone: {
    backgroundColor: theme.colors.dangerMuted,
    borderBottomRightRadius: theme.radii.pill,
    borderTopRightRadius: theme.radii.pill,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '20%',
  },
  ticker: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.ticker.size,
    fontWeight: theme.type.ticker.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  track: {
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.pill,
    height: TRACK_HEIGHT,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  wrap: {
    width: '100%',
  },
});
