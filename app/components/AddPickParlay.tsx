import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export const PARLAY_MIN_LEGS = 2;
export const PARLAY_MAX_LEGS = 12;

/** Plain-language state of the parlay under its legs. */
export function parlayHint(legCount: number): string {
  if (legCount === 0) return 'Add at least 2 legs. Each leg can be any type of pick.';
  if (legCount < PARLAY_MIN_LEGS) return 'Add 1 more leg to save this parlay.';
  if (legCount >= PARLAY_MAX_LEGS) return `A parlay can have up to ${PARLAY_MAX_LEGS} legs.`;
  return 'Every leg has to win for the parlay to win. A tied leg is refunded and drops out.';
}

/**
 * The parlay's own step: Add a leg and Save. The slip above lists every leg, with Remove.
 * Legs are added one at a time through the same steps as a single pick, and the parlay saves
 * as one slip.
 */
export function AddPickParlay({
  legCount,
  note,
  error,
  saving,
  disabled = false,
  saveBlocked = false,
  onAddLeg,
  onSave,
}: {
  legCount: number;
  note: string | null;
  error: string | null;
  saving: boolean;
  disabled?: boolean;
  /** Imported legs still need a check (added by hand or dismissed). */
  saveBlocked?: boolean;
  onAddLeg: () => void;
  onSave: () => void;
}) {
  const full = legCount >= PARLAY_MAX_LEGS;
  return (
    <View style={styles.stack} testID="add-pick-parlay">
      <Text style={styles.hint} testID="add-pick-parlay-hint">
        {parlayHint(legCount)}
      </Text>
      <SecondaryButton disabled={disabled || full} label="Add a leg" onPress={onAddLeg} />
      {note ? (
        <Text style={styles.note} testID="add-pick-allowance">
          {note}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        disabled={disabled || saveBlocked || legCount < PARLAY_MIN_LEGS}
        label="Save parlay"
        loading={saving}
        onPress={onSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.body.size,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  note: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stack: {
    gap: theme.spacing.lg,
  },
});
