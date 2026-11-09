import { StyleSheet, Text, View } from 'react-native';

import type { FlaggedLeg } from '../lib/slipImport';
import { theme } from '../lib/theme';
import { TextButton } from './TextButton';

/**
 * Legs from an imported slip that Pivot could not match. Each shows what the slip printed and
 * why, until the user adds it by hand (Add a leg) or dismisses it. The parlay can't be saved
 * while any are left, so no leg is dropped without the user seeing it.
 */
export function AddPickImportFlags({
  legs,
  onDismiss,
  disabled = false,
}: {
  legs: readonly FlaggedLeg[];
  onDismiss: (key: string) => void;
  disabled?: boolean;
}) {
  if (legs.length === 0) return null;
  return (
    <View style={styles.card} testID="add-pick-import-flags">
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
        NEEDS YOUR CHECK
      </Text>
      <Text style={styles.hint}>
        {legs.length === 1
          ? 'We couldn’t add this leg from your screenshot. Add it with Add a leg, or dismiss it.'
          : 'We couldn’t add these legs from your screenshot. Add them with Add a leg, or dismiss them.'}
      </Text>
      {legs.map((leg) => (
        <View key={leg.key} style={styles.row} testID="add-pick-import-flag">
          <View style={styles.info}>
            <Text style={styles.text}>{leg.text}</Text>
            <Text style={styles.reason}>{leg.reason}</Text>
          </View>
          <TextButton
            accessibilityLabel={`Dismiss ${leg.text}`}
            disabled={disabled}
            hitArea="slop"
            label="Dismiss"
            onPress={() => onDismiss(leg.key)}
            size="smallStrong"
            tone="danger"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  info: {
    flex: 1,
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  reason: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  text: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
  },
});
