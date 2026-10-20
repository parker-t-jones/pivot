import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';

/** The slip above this is the review. No second copy of the pick line. */
export function AddPickReview({
  readout,
  note,
  error,
  saving,
  onSubmit,
}: {
  readout: string | null;
  note: string | null;
  error: string | null;
  saving: boolean;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.stack} testID="add-pick-review">
      {readout ? (
        <Text style={styles.readout} testID="add-pick-readout">
          {readout}
        </Text>
      ) : null}
      {note ? (
        <Text style={styles.note} testID="add-pick-allowance">
          {note}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton label="Add a pick" loading={saving} onPress={onSubmit} />
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.body.size,
  },
  note: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  readout: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stack: {
    gap: theme.spacing.md,
  },
});
