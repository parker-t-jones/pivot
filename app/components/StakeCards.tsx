import { StyleSheet, Text, View } from 'react-native';

import { axisPercent, type LineScaleModel, type RosterStripSegment } from '../lib/stakeCards';
import { theme } from '../lib/theme';

export function RosterStripCard({ segments }: { segments: readonly RosterStripSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        numberOfLines={1}
        style={styles.eyebrow}
      >
        GAMES
      </Text>
      <View style={styles.strip}>
        {segments.map((segment) => (
          <View key={segment.key} style={[styles.segment, { width: `${segment.widthPercent}%` }]}>
            <View style={styles.segmentBar} />
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              numberOfLines={1}
              style={styles.segmentLabel}
            >
              {segment.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Number line with the cover side shaded and a live marker. Shared with `PickCard`. */
export function LineScale({ model, axisLabel }: { model: LineScaleModel; axisLabel: string }) {
  const coverLeft = axisPercent(model.coverFrom, model.axisMin, model.axisMax);
  const coverWidth = axisPercent(model.coverTo, model.axisMin, model.axisMax) - coverLeft;
  const lineLeft = axisPercent(model.lineAt, model.axisMin, model.axisMax);
  const markerLeft =
    model.marker == null ? null : axisPercent(model.marker.position, model.axisMin, model.axisMax);
  return (
    <View>
      <View style={styles.scale}>
        {model.marker?.arrow === 'low' ? <Text style={styles.arrow}>{'◀'}</Text> : null}
        <View style={styles.trackWrap}>
          <View style={styles.track}>
            <View style={[styles.cover, { left: `${coverLeft}%`, width: `${coverWidth}%` }]} />
          </View>
          <View style={[styles.lineMark, { left: `${lineLeft}%` }]} />
          {model.marker && markerLeft != null ? (
            <View style={[styles.marker, { left: `${markerLeft}%` }]} />
          ) : null}
        </View>
        {model.marker?.arrow === 'high' ? <Text style={styles.arrow}>{'▶'}</Text> : null}
      </View>
      <View style={styles.axisLabels}>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.axis}
        >
          {`−${axisLabel}`}
        </Text>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.axis}
        >
          {`+${axisLabel}`}
        </Text>
      </View>
    </View>
  );
}

const MARKER = 12;
const SCALE = 16;

const styles = StyleSheet.create({
  arrow: {
    color: theme.colors.flare,
    fontSize: theme.type.caption.size,
    lineHeight: MARKER,
  },
  axis: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
  },
  axisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  cover: {
    backgroundColor: theme.colors.ember,
    bottom: 0,
    position: 'absolute',
    top: 0,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  lineMark: {
    backgroundColor: theme.colors.textPrimary,
    bottom: -3,
    marginLeft: -1,
    position: 'absolute',
    top: -3,
    width: 2,
  },
  marker: {
    backgroundColor: theme.colors.flare,
    borderRadius: MARKER / 2,
    height: MARKER,
    marginLeft: -MARKER / 2,
    marginTop: (SCALE - MARKER) / 2,
    position: 'absolute',
    top: 0,
    width: MARKER,
  },
  scale: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  segment: {
    gap: theme.spacing.xs,
    overflow: 'hidden',
  },
  segmentBar: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    height: 8,
  },
  segmentLabel: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
  },
  strip: {
    flexDirection: 'row',
  },
  track: {
    backgroundColor: theme.colors.well,
    borderRadius: theme.radii.pill,
    height: 8,
    overflow: 'hidden',
  },
  trackWrap: {
    flex: 1,
    height: SCALE,
    justifyContent: 'center',
  },
});
