import { useState, type ReactElement } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '../lib/theme';

/** Enough dashes to fill a phone-width ticket; the row clips the extras. */
const DASH_COUNT = 48;
const DASH_WIDTH = 6;
const DASH_GAP = 4;
const NOTCH = 14;

/** How many dashes cover `width`, including a clip at the far end. */
export function dashCountForWidth(width: number): number {
  if (width <= 0) return DASH_COUNT;
  return Math.max(1, Math.ceil((width + DASH_GAP) / (DASH_WIDTH + DASH_GAP)));
}

interface SlipPerforationProps {
  style?: StyleProp<ViewStyle>;
  /**
   * `ticket` is the full-width WeekCard cut (notches hang off the ends).
   * `card` is the bottom edge of a bounded card: no negative offsets, notches
   * stay inside the card, and the dashes replace a bottom border.
   */
  edge?: 'ticket' | 'card';
}

function dashes(count: number): ReactElement[] {
  return Array.from({ length: count }, (_, index) => <View key={index} style={styles.dash} />);
}

/** Card-edge dashes. The row is the full middle width; the count follows that width. */
function CardDashRule() {
  const [count, setCount] = useState(DASH_COUNT);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = dashCountForWidth(event.nativeEvent.layout.width);
    setCount((current) => (current === next ? current : next));
  };
  return (
    <View onLayout={onLayout} style={cardStyles.rule} testID="slip-perforation-dashes">
      {dashes(count)}
    </View>
  );
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
          <CardDashRule />
          <View style={cardStyles.below} />
        </View>
        <View style={[cardStyles.notch, cardStyles.notchRight]} />
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <View style={[styles.notch, styles.notchStart]} />
      <View style={styles.rule}>{dashes(DASH_COUNT)}</View>
      <View style={[styles.notch, styles.notchEnd]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dash: {
    backgroundColor: theme.colors.border,
    height: StyleSheet.hairlineWidth,
    width: DASH_WIDTH,
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
    gap: DASH_GAP,
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
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: DASH_GAP,
    height: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    width: '100%',
  },
});
