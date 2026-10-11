import { StyleSheet, Text, View } from 'react-native';

import {
  axisPercent,
  type CoverOutcome,
  type LineScaleModel,
  type RosterStripSegment,
  type SurvivorBadgeModel,
} from '../lib/stakeCards';
import { theme } from '../lib/theme';

interface LineCardProps {
  label: string;
  matchup: string;
  kickoff: string;
  model: LineScaleModel;
  axisLabel: string;
}

/** Spread number line. Cover sits on the positive side of the line. */
export function SpreadLineCard(props: LineCardProps) {
  return <LineCard {...props} />;
}

/** Total number line. The shaded side is Over (above) or Under (below). */
export function TotalLineCard(props: LineCardProps) {
  return <LineCard {...props} />;
}

export function SurvivorBadgeCard({ model }: { model: SurvivorBadgeModel }) {
  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}>
        <View style={styles.ring}>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.ringLabel}
          >
            {model.abbreviation}
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.tag}
        >
          {model.status}
        </Text>
      </View>
    </View>
  );
}

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

function LineCard({ label, matchup, kickoff, model, axisLabel }: LineCardProps) {
  const meta = [matchup, kickoff].filter((part) => part.length > 0).join(' · ');
  return (
    <View style={styles.card}>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </Text>
      {meta.length > 0 ? (
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.meta}
        >
          {meta}
        </Text>
      ) : null}
      <LineScale axisLabel={axisLabel} model={model} />
      {model.outcome ? <OutcomeTag outcome={model.outcome} /> : null}
    </View>
  );
}

function LineScale({ model, axisLabel }: { model: LineScaleModel; axisLabel: string }) {
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

function OutcomeTag({ outcome }: { outcome: CoverOutcome }) {
  const label = outcome === 'covered' ? 'Covered' : outcome === 'pushed' ? 'Pushed' : 'Lost';
  return (
    <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} numberOfLines={1} style={styles.tag}>
      {label}
    </Text>
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
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
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
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
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
  meta: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  ring: {
    alignItems: 'center',
    borderColor: theme.colors.accent,
    borderRadius: 28,
    borderWidth: 2,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  ringLabel: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
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
  tag: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
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
