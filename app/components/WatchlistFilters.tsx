import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WATCHLIST_FILTERS, type WatchlistFilter } from '../lib/watchlistFilter';
import { theme } from '../lib/theme';

interface WatchlistFiltersProps {
  value: WatchlistFilter;
  onChange: (key: string) => void;
}

/** Session-scoped All / Fantasy / Bets / Pools pills. Selected pill uses the accent label. */
export function WatchlistFilters({ value, onChange }: WatchlistFiltersProps) {
  return (
    <View style={styles.row}>
      {WATCHLIST_FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Pressable
            key={filter.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(filter.key)}
            style={[styles.pill, selected && styles.pillSelected]}
          >
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              numberOfLines={1}
              style={[styles.label, selected && styles.labelSelected]}
            >
              {filter.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  labelSelected: {
    color: theme.colors.accent,
  },
  pill: {
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  pillSelected: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
});
