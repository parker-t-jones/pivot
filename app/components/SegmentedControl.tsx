import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

/** Track height from PIVOT-STAKES-PLAN.md §11.2. */
const TRACK_HEIGHT = 44;

export interface SegmentOption {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  segments: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
}

/**
 * Two-or-more tab switch used by Home's BOARD | MY CARD (PIVOT-STAKES-PLAN.md §11.2).
 * Selected segment is `surfaceRaised` with an `accent` label; the track sits in a `well`.
 */
export function SegmentedControl({ segments, value, onChange }: SegmentedControlProps) {
  return (
    <View accessibilityRole="tablist" style={styles.track}>
      {segments.map((segment) => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(segment.key);
            }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{segment.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  labelSelected: {
    color: theme.colors.accent,
  },
  segment: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    // Match the track's outer radius so the selected fill seats flush against the stroke.
    borderRadius: theme.radii.md,
    paddingVertical: theme.spacing.sm,
  },
  segmentSelected: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  track: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    flexDirection: 'row',
    height: TRACK_HEIGHT,
    padding: theme.spacing.xs,
  },
});
