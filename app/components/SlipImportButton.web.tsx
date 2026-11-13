import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isImageFile, pickSlipImage, readSlipFile } from '../lib/slipImage.web';
import { theme } from '../lib/theme';
import { SecondaryButton } from './SecondaryButton';
import { SLIP_IMPORT_LABEL, type SlipImportButtonProps } from './slipImportShared';

export { SLIP_IMPORT_LABEL };

/** "Import from screenshot" on web: a file picker, and a drop target for a screenshot file. */
export function SlipImportButton({
  onImage,
  onLocked = null,
  loading,
  disabled = false,
  onError,
}: SlipImportButtonProps) {
  const zone = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const active = !disabled && !loading && onLocked === null;

  useEffect(() => {
    // react-native-web renders a View as a div, so DOM drag events attach to it directly.
    const node = zone.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const over = (event: DragEvent) => {
      if (!active) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = (event: DragEvent) => {
      if (!active) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      if (!isImageFile(file)) {
        onError('Drop an image of your bet slip, like a PNG or JPEG screenshot.');
        return;
      }
      readSlipFile(file).then(onImage, () => onError('We couldn’t read that file. Try again.'));
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
  }, [active, onError, onImage]);

  const press = () => {
    if (onLocked) {
      onLocked();
      return;
    }
    void pickSlipImage().then(
      (image) => {
        if (image) onImage(image);
      },
      () => onError('We couldn’t read that file. Try again.'),
    );
  };

  return (
    <View
      ref={zone}
      style={[styles.zone, dragging ? styles.dragging : undefined]}
      testID="slip-import-drop-zone"
    >
      <SecondaryButton
        caption={
          onLocked ? 'No free bets left · Upgrade' : 'Choose a file, or drop a screenshot here'
        }
        disabled={disabled}
        label={SLIP_IMPORT_LABEL}
        loading={loading}
        onPress={press}
      />
      {dragging ? <Text style={styles.hint}>Drop to import your bet slip.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dragging: {
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accent,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    textAlign: 'center',
  },
  zone: {
    borderColor: 'transparent',
    borderRadius: theme.radii.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: theme.spacing.sm,
  },
});
