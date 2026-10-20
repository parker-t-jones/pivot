import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { theme } from '../lib/theme';

const DASH_WIDTH = 6;
const DASH_GAP = 4;
const NOTCH = 14;
/** Covers a wide window before the row has been measured. Extras clip. */
const FALLBACK_WIDTH = 1920;

/** How many dashes cover `width`, including a clip at the far end. */
export function dashCountForWidth(width: number): number {
  const target = width > 0 ? width : FALLBACK_WIDTH;
  return Math.max(1, Math.ceil((target + DASH_GAP) / (DASH_WIDTH + DASH_GAP)));
}

interface SlipPerforationProps {
  style?: StyleProp<ViewStyle>;
  /**
   * `ticket` is the WeekCard cut: dashes fill the card, and the notches are
   * side cut-outs centered on that line.
   * `card` is the bottom edge of a bounded card: notches stay inside, and the
   * dashes replace a bottom border.
   */
  edge?: 'ticket' | 'card';
}

function dashes(count: number): ReactElement[] {
  return Array.from({ length: count }, (_, index) => <View key={index} style={styles.dash} />);
}

/** Dashes that follow the measured width of this row. */
function DashRule({ testID, style }: { testID: string; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  const [count, setCount] = useState(() => dashCountForWidth(FALLBACK_WIDTH));
  const sync = (width: number) => {
    const next = dashCountForWidth(width);
    setCount((current) => (current === next ? current : next));
  };
  const onLayout = (event: LayoutChangeEvent) => {
    sync(event.nativeEvent.layout.width);
  };
  useLayoutEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (node == null || typeof node.offsetWidth !== 'number') return;
    const update = () => sync(node.offsetWidth);
    update();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
    observer?.observe(node);
    const onResize = () => update();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onResize);
    }
    return () => {
      observer?.disconnect();
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onResize);
      }
    };
  }, []);
  return (
    <View ref={ref} onLayout={onLayout} style={[styles.rule, style]} testID={testID}>
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
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={cardStyles.middle}>
          <View style={cardStyles.above} />
          <DashRule style={cardStyles.rule} testID="slip-perforation-dashes" />
          <View style={cardStyles.below} />
        </View>
        <View style={[styles.notch, styles.notchRight]} />
      </View>
    );
  }

  return (
    <View style={[styles.row, style]} testID="slip-perforation">
      <View style={[styles.notch, styles.notchLeft]} />
      <DashRule testID="slip-perforation-dashes" />
      <View style={[styles.notch, styles.notchRight]} />
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
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    height: NOTCH,
    overflow: 'hidden',
    width: '100%',
  },
  rule: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: DASH_GAP,
    height: StyleSheet.hairlineWidth,
    minWidth: 0,
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
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    height: NOTCH,
    overflow: 'hidden',
    width: '100%',
  },
  rule: {
    flex: 0,
    width: '100%',
  },
});
