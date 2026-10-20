import { useSyncExternalStore, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { StyleSheet, Text, View } from 'react-native';

import { TextButton } from './TextButton';
import { getStakeUndoState, subscribeStakeUndo, undoStake } from '../lib/stakeUndoStore';
import { theme } from '../lib/theme';

/**
 * App-level undo toast. Portaled onto `document.body` with `position: fixed`
 * so the watchlist shell's `overflow: hidden` cannot clip it, and so removing
 * a row (which only unmounts that row) cannot take the toast with it.
 */
export function StakeUndoToast(): ReactPortal | null {
  const undo = useSyncExternalStore(subscribeStakeUndo, getStakeUndoState, getStakeUndoState);
  if (typeof document === 'undefined') return null;
  if (undo.pendingId == null && undo.error == null) return null;

  return createPortal(
    <div data-testid="stake-undo-toast" style={dockStyle}>
      <View pointerEvents="auto" style={styles.toast}>
        <Text style={styles.toastText}>{undo.error ?? 'Removed'}</Text>
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
    </div>,
    document.body,
  );
}

const dockStyle = {
  bottom: theme.spacing.xl,
  display: 'flex',
  justifyContent: 'center',
  left: 0,
  pointerEvents: 'none',
  position: 'fixed',
  right: 0,
  zIndex: 1000,
} as const;

const styles = StyleSheet.create({
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
