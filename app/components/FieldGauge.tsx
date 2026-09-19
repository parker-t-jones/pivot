import { StyleSheet, Text, View } from 'react-native';

import {
  FIELD_GAUGE_RED_ZONE_PERCENT,
  FIELD_GAUGE_TICK_LABELS,
  fieldGaugeMarkerPercent,
  fieldGaugeTickPercent,
  fieldPositionLabel,
  gameClockLine,
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
 * UI-SPEC.md §3.1 numbered 100-yard stick: always-on red-zone geography, possession marker,
 * field-position + RED ZONE captions, and a clock line that appends down/distance when present.
 * When `yardsToEndzone` is null (kickoff / timeout) the stick is omitted but the clock stays.
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
  const clock = gameClockLine(quarter, timeRemainingSec, down, distance);
  const showStick = yardsToEndzone !== null;
  const markerPercent = showStick ? fieldGaugeMarkerPercent(yardsToEndzone) : 0;
  const position = showStick
    ? fieldPositionLabel(yardsToEndzone, possessionTeam, opponentTeam)
    : null;

  return (
    <View style={styles.wrap}>
      {showStick ? (
        <>
          <View style={styles.stick}>
            <View style={styles.redZone} />
            <View style={styles.axis} />
            {FIELD_GAUGE_TICK_LABELS.map((label, index) => (
              <View
                key={`${label}-${index}`}
                style={[styles.tick, { left: `${fieldGaugeTickPercent(index)}%` }]}
              />
            ))}
            <View style={[styles.marker, { left: `${markerPercent}%` }]} />
          </View>
          <View style={styles.tickLabels}>
            {FIELD_GAUGE_TICK_LABELS.map((label, index) => (
              <Text
                key={`${label}-${index}`}
                style={[styles.tickLabel, { left: `${fieldGaugeTickPercent(index)}%` }]}
              >
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.captions}>
            {position ? (
              <Text style={[styles.positionCaption, { left: `${markerPercent}%` }]}>{position}</Text>
            ) : null}
            <Text style={styles.redZoneCaption}>RED ZONE</Text>
          </View>
        </>
      ) : null}
      <Text style={styles.ticker}>{clock}</Text>
    </View>
  );
}

const STICK_HEIGHT = 14;
const MARKER_SIZE = 10;
const TICK_LABEL_WIDTH = 24;
const POSITION_CAPTION_WIDTH = 64;

const styles = StyleSheet.create({
  axis: {
    backgroundColor: theme.colors.textTertiary,
    height: StyleSheet.hairlineWidth * 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: STICK_HEIGHT / 2,
  },
  captions: {
    height: 18,
    marginBottom: theme.spacing.xs,
    position: 'relative',
    width: '100%',
  },
  marker: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    height: MARKER_SIZE,
    marginLeft: -MARKER_SIZE / 2,
    position: 'absolute',
    top: (STICK_HEIGHT - MARKER_SIZE) / 2,
    width: MARKER_SIZE,
    zIndex: 2,
  },
  positionCaption: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
    marginLeft: -POSITION_CAPTION_WIDTH / 2,
    position: 'absolute',
    textAlign: 'center',
    width: POSITION_CAPTION_WIDTH,
  },
  redZone: {
    backgroundColor: theme.colors.dangerMuted,
    borderBottomRightRadius: theme.radii.sm,
    borderTopRightRadius: theme.radii.sm,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: `${FIELD_GAUGE_RED_ZONE_PERCENT}%`,
  },
  redZoneCaption: {
    color: theme.colors.danger,
    fontSize: theme.type.ticker.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
    position: 'absolute',
    right: 0,
    textAlign: 'right',
    width: `${FIELD_GAUGE_RED_ZONE_PERCENT}%`,
  },
  stick: {
    height: STICK_HEIGHT,
    marginBottom: theme.spacing.xs,
    overflow: 'visible',
    position: 'relative',
    width: '100%',
  },
  tick: {
    backgroundColor: theme.colors.textTertiary,
    height: 8,
    marginLeft: -0.5,
    position: 'absolute',
    top: STICK_HEIGHT / 2 - 8,
    width: 1,
  },
  tickLabel: {
    color: theme.colors.textTertiary,
    fontSize: 9,
    fontVariant: [...theme.type.ticker.fontVariant],
    marginLeft: -TICK_LABEL_WIDTH / 2,
    position: 'absolute',
    textAlign: 'center',
    width: TICK_LABEL_WIDTH,
  },
  tickLabels: {
    height: 14,
    position: 'relative',
    width: '100%',
  },
  ticker: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: theme.type.ticker.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  wrap: {
    width: '100%',
  },
});
