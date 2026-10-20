import { useEffect, useRef, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AddPickFlow } from './AddPickFlow';
import { closeAddPick, takeAddPickReturnFocus } from '../lib/addPickDrawer';
import { theme } from '../lib/theme';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand drawer inside the desktop scene. The sidebar is a sibling of that
 * scene, so it stays visible, and the tab screen underneath stays mounted.
 */
export function AddPickDrawer(): ReactElement {
  const panelRef = useRef<View>(null);

  useEffect(() => {
    const previous = takeAddPickReturnFocus();
    const node = panelRef.current as unknown as HTMLElement | null;
    const close = node?.querySelector<HTMLElement>('[data-testid="add-pick-close"]');
    close?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAddPick();
        return;
      }
      if (event.key !== 'Tab' || node == null) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => !item.hasAttribute('disabled') && item.tabIndex >= 0,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first == null || last == null) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <View style={[styles.overlay, StyleSheet.absoluteFill]}>
      <Pressable
        accessibilityLabel="Close add a pick"
        accessibilityRole="button"
        onPress={closeAddPick}
        style={[styles.backdrop, StyleSheet.absoluteFill]}
        testID="add-pick-backdrop"
      />
      <View ref={panelRef} accessibilityViewIsModal style={styles.panel} testID="add-pick-drawer">
        <View style={styles.closeRow}>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            onPress={closeAddPick}
            style={styles.close}
            testID="add-pick-close"
          >
            <Text style={styles.closeLabel}>×</Text>
          </Pressable>
        </View>
        <AddPickFlow closeAffordance="parent" onDismiss={closeAddPick} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: theme.colors.background,
    opacity: 0.72,
  },
  close: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  closeLabel: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    lineHeight: theme.type.title.lineHeight,
  },
  closeRow: {
    alignItems: 'flex-end',
    paddingRight: theme.spacing.sm,
  },
  overlay: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  panel: {
    backgroundColor: theme.colors.background,
    borderLeftColor: theme.colors.border,
    borderLeftWidth: theme.effects.panelBorderWidth,
    height: '100%',
    width: theme.spacing.huge * 10,
    zIndex: 1,
  },
});
