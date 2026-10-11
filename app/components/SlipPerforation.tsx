import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '../lib/theme';

/** Enough dashes to fill a phone-width slip; the row clips the extras. */
const DASH_COUNT = 48;
const NOTCH = 14;

interface SlipPerforationProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Ticket perforation for a `Slip` (PIVOT-STAKES-PLAN.md §11.2). A dashed hairline with a
 * half-circle notch at each end, filled with the Slip background so the cut reads as a hole
 * through the card.
 */
export function SlipPerforation({ style }: SlipPerforationProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.notch, styles.notchStart]} />
      <View style={styles.rule}>
        {Array.from({ length: DASH_COUNT }, (_, index) => (
          <View key={index} style={styles.dash} />
        ))}
      </View>
      <View style={[styles.notch, styles.notchEnd]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dash: {
    backgroundColor: theme.colors.border,
    height: StyleSheet.hairlineWidth,
    width: 6,
  },
  notch: {
    backgroundColor: theme.colors.background,
    borderRadius: NOTCH / 2,
    height: NOTCH,
    position: 'absolute',
    width: NOTCH,
  },
  notchEnd: {
    right: -NOTCH / 2,
  },
  notchStart: {
    left: -NOTCH / 2,
  },
  row: {
    alignItems: 'center',
    height: NOTCH,
    justifyContent: 'center',
    overflow: 'visible',
  },
  rule: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    overflow: 'hidden',
  },
});
