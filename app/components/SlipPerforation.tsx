import { type ReactElement } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '../lib/theme';

/** Enough dashes to fill a phone-width slip; the row clips the extras. */
const DASH_COUNT = 48;
const NOTCH = 14;

interface SlipPerforationProps {
  style?: StyleProp<ViewStyle>;
  /**
   * `ticket` is the full-width WeekCard cut (notches hang off the ends).
   * `card` is the bottom edge of a bounded card: no negative offsets, notches
   * stay inside the card, and the dashes replace a bottom border.
   */
  edge?: 'ticket' | 'card';
}

function dashes(): ReactElement[] {
  return Array.from({ length: DASH_COUNT }, (_, index) => <View key={index} style={styles.dash} />);
}

/**
 * Ticket perforation for a `Slip` (PIVOT-STAKES-PLAN.md §11.2). A dashed hairline with a
 * half-circle notch at each end, filled with the Slip background so the cut reads as a hole
 * through the card.
 */
export function SlipPerforation({ style, edge = 'ticket' }: SlipPerforationProps) {
  if (edge === 'card') {
    return (
      <View style={[cardStyles.row, style]} testID="slip-perforation-card">
        <View style={[cardStyles.notch, cardStyles.notchLeft]} />
        <View style={cardStyles.middle}>
          <View style={cardStyles.above} />
          <View style={cardStyles.rule}>{dashes()}</View>
          <View style={cardStyles.below} />
        </View>
        <View style={[cardStyles.notch, cardStyles.notchRight]} />
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <View style={[styles.notch, styles.notchStart]} />
      <View style={styles.rule}>{dashes()}</View>
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

const cardStyles = StyleSheet.create({
  above: {
    backgroundColor: theme.colors.surface,
    flex: 1,
  },
  below: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  middle: {
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  notch: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    height: NOTCH,
    width: NOTCH / 2,
  },
  notchLeft: {
    borderBottomRightRadius: NOTCH / 2,
    borderBottomWidth: theme.effects.panelBorderWidth,
    borderRightWidth: theme.effects.panelBorderWidth,
    borderTopRightRadius: NOTCH / 2,
    borderTopWidth: theme.effects.panelBorderWidth,
  },
  notchRight: {
    borderBottomLeftRadius: NOTCH / 2,
    borderBottomWidth: theme.effects.panelBorderWidth,
    borderLeftWidth: theme.effects.panelBorderWidth,
    borderTopLeftRadius: NOTCH / 2,
    borderTopWidth: theme.effects.panelBorderWidth,
  },
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    height: NOTCH,
    overflow: 'hidden',
    width: '100%',
  },
  rule: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
