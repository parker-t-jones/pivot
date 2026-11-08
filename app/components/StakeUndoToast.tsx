import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextButton } from './TextButton';
import { getStakeUndoState, subscribeStakeUndo, undoStake } from '../lib/stakeUndoStore';
import { theme } from '../lib/theme';

/** Clears the tab bar (its padding plus icon and label) above the home-indicator inset. */
const TAB_BAR_CLEARANCE = theme.spacing.huge + theme.spacing.xl;

/**
 * Native undo toast for a swiped-away Watchlist pick (issue #14). Same store and copy as the
 * desktop toast in `StakeUndoToast.web.tsx`. Mounted once in the `(app)` layout, so removing the
 * row cannot unmount it.
 */
export function StakeUndoToast() {
  const undo = useSyncExternalStore(subscribeStakeUndo, getStakeUndoState, getStakeUndoState);
  const insets = useSafeAreaInsets();
  if (undo.pendingId == null && undo.error == null) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]}
      testID="stake-undo-toast"
    >
      <View accessibilityLiveRegion="polite" style={styles.toast}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.toastText}>
          {undo.error ?? 'Removed'}
        </Text>
        {undo.pendingId != null ? (
          <TextButton
            hitArea="padding"
            label="Undo"
            labelStyle={styles.undoLabel}
            onPress={undoStake}
            size="button"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  toast: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radii.pill,
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  toastText: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  undoLabel: {
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
});
