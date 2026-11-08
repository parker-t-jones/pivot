import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { swipeDecision, swipeShouldCapture, SWIPE_MIN_TRAVEL } from '../lib/swipeToRemove';
import { theme } from '../lib/theme';

interface SwipeToRemoveProps {
  /** Called once the row has slid off. The caller hides it and shows the Undo toast. */
  onRemove: () => void;
  /** Read by VoiceOver with the "Remove" action, e.g. "DET −3.5". */
  accessibilityLabel: string;
  children: ReactNode;
  testID?: string;
}

const SLIDE_OUT_MS = 160;

/**
 * Phone Watchlist removal (issue #14): swipe a pick left to remove it. No confirm and no red
 * text; the Undo toast is the safety net. Built on `PanResponder` so it needs no native module.
 * VoiceOver gets a "Remove" custom action instead of the gesture.
 */
export function SwipeToRemove({
  onRemove,
  accessibilityLabel,
  children,
  testID,
}: SwipeToRemoveProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(0);
  const removedRef = useRef(false);
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const [revealed, setRevealed] = useState(false);

  const responder = useMemo(() => {
    const settle = () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(() => {
        setRevealed(false);
      });
    };
    const remove = () => {
      if (removedRef.current) return;
      removedRef.current = true;
      Animated.timing(translateX, {
        toValue: -Math.max(widthRef.current, SWIPE_MIN_TRAVEL),
        duration: SLIDE_OUT_MS,
        useNativeDriver: true,
      }).start(() => {
        onRemoveRef.current();
      });
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => swipeShouldCapture(gesture.dx, gesture.dy),
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        swipeShouldCapture(gesture.dx, gesture.dy),
      // Once the row is sliding, a vertical scroll must not steal it back.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setRevealed(true),
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(Math.min(0, gesture.dx));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (swipeDecision(gesture.dx, gesture.vx, widthRef.current) === 'remove') remove();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [translateX]);

  const onLayout = (event: LayoutChangeEvent) => {
    widthRef.current = event.nativeEvent.layout.width;
  };

  return (
    <View onLayout={onLayout} style={styles.wrap} testID={testID}>
      {revealed ? (
        <View style={styles.action} testID="swipe-remove-action">
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.actionLabel}>
            Remove
          </Text>
        </View>
      ) : null}
      <Animated.View
        accessibilityActions={[{ name: 'remove', label: 'Remove' }]}
        accessibilityHint="Swipe left to remove this pick."
        accessibilityLabel={accessibilityLabel}
        accessible
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'remove') onRemoveRef.current();
        }}
        style={{ transform: [{ translateX }] }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'flex-end',
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radii.lg,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: theme.spacing.xl,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  actionLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
    lineHeight: theme.type.smallStrong.lineHeight,
  },
  wrap: {
    position: 'relative',
  },
});
