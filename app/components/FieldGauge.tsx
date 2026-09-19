import { StyleSheet, Text, View } from 'react-native';

import {
  FIELD_GAUGE_MINOR_TICK_PERCENTS,
  FIELD_GAUGE_RED_ZONE_PERCENT,
  FIELD_GAUGE_TICK_LABELS,
  fieldGaugeMarkerPercent,
  fieldGaugeShowsRedZone,
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
 * UI-SPEC.md §3.1 numbered 100-yard stick: filled bar with yard ticks, always-on red-zone
 * geography, possession marker, field-position + RED ZONE captions, and a clock line that
 * appends down/distance when present. When `yardsToEndzone` is null (kickoff / timeout) the
 * stick is omitted but the clock stays.
 *
 * When the ball is inside the red zone, the "RED ZONE" caption is omitted so it doesn't collide
 * with the field-position label sitting under the marker (the red fill itself is the geography cue).
 *
 * Border lives on the clipped `bar` (solid fill + overflow:hidden). Absolute children are nested
 * inside that bar so they can't paint over the stroke — RN absolute fills cover parent borders
 * when they're siblings of a border-only overlay.
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
  const showRedZoneCaption =
    showStick && yardsToEndzone !== null && !fieldGaugeShowsRedZone(yardsToEndzone);

  return (
    <View style={styles.wrap}>
      {showStick ? (
        <>
          <View style={styles.stick}>
            <View style={styles.bar}>
              <View style={styles.redZone} />
              {FIELD_GAUGE_MINOR_TICK_PERCENTS.map((percent) => (
                <View
                  key={`minor-${percent}`}
                  style={[styles.tickMinor, { left: `${percent}%` }]}
                />
              ))}
              {FIELD_GAUGE_TICK_LABELS.map((label, index) => {
                const isFifty = label === 50;
                return (
                  <View
                    key={`${label}-${index}`}
                    style={[
                      styles.tick,
                      isFifty ? styles.tickMidfield : null,
                      { left: `${fieldGaugeTickPercent(index)}%` },
                    ]}
                  />
                );
              })}
            </View>
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
              <Text
                style={[
                  styles.positionCaption,
                  { left: `${clampedCaptionLeft(markerPercent)}%` },
                ]}
              >
                {position}
              </Text>
            ) : null}
            {showRedZoneCaption ? <Text style={styles.redZoneCaption}>RED ZONE</Text> : null}
          </View>
        </>
      ) : null}
      <Text style={styles.ticker}>{clock}</Text>
    </View>
  );
}

/** Keep the position caption fully on-screen; percent is the marker center. */
function clampedCaptionLeft(markerPercent: number): number {
  const halfWidthPercent = (POSITION_CAPTION_WIDTH / 2 / ASSUMED_STICK_WIDTH) * 100;
  return Math.max(halfWidthPercent, Math.min(100 - halfWidthPercent, markerPercent));
}

const STICK_HEIGHT = 22;
const MARKER_SIZE = 12;
const TICK_LABEL_WIDTH = 24;
const POSITION_CAPTION_WIDTH = 64;
/** Used only to clamp caption % — real width is flex; close enough for edge padding. */
const ASSUMED_STICK_WIDTH = 320;

/** Darker crimson at lower opacity — reads as a stained zone, not a neon wash. */
const RED_ZONE_FILL = 'rgba(110, 18, 22, 0.42)';
const TRACK_FILL = '#14181C';
/** Lighter than `theme.colors.border` so the stroke reads against the dark track fill. */
const BAR_BORDER = 'rgba(255, 255, 255, 0.28)';

const styles = StyleSheet.create({
  /**
   * Bordered field body. Border + solid backgroundColor + overflow:hidden on the SAME view —
   * required so absolute fills/ticks can't cover the stroke (RN paints children over parent
   * borders when they're siblings of a transparent border-only overlay).
   */
  bar: {
    backgroundColor: TRACK_FILL,
    borderColor: BAR_BORDER,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  captions: {
    height: 18,
    marginBottom: theme.spacing.xs,
    position: 'relative',
    width: '100%',
  },
  marker: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.onAccent,
    borderRadius: theme.radii.pill,
    borderWidth: 1.5,
    height: MARKER_SIZE,
    marginLeft: -MARKER_SIZE / 2,
    position: 'absolute',
    top: (STICK_HEIGHT - MARKER_SIZE) / 2,
    width: MARKER_SIZE,
    zIndex: 2,
  },
  positionCaption: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
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
    backgroundColor: RED_ZONE_FILL,
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: `${FIELD_GAUGE_RED_ZONE_PERCENT}%`,
  },
  redZoneCaption: {
    color: theme.colors.danger,
    fontFamily: theme.type.ticker.fontFamily,
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
    position: 'relative',
    width: '100%',
  },
  tick: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    bottom: 0,
    marginLeft: -0.5,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  tickLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.ticker.fontFamily,
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
  tickMidfield: {
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    marginLeft: -1,
    width: 2,
  },
  /** Half-height hashes at the 5-yard lines between labeled tens. */
  tickMinor: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    bottom: 5,
    marginLeft: -0.5,
    position: 'absolute',
    top: 5,
    width: 1,
  },
  ticker: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: theme.type.ticker.weight,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  wrap: {
    width: '100%',
  },
});
