import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { theme } from '../lib/theme';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Sprint 9 Phase 2 shared error block — same "consistency over novelty" rationale as
 *  `EmptyState`/`LoadingState`. `onRetry` is optional: some errors (e.g. a failed one-off mutation)
 *  don't have a meaningful retry action, just a message. */
export function ErrorState({ message, onRetry, retryLabel = 'Retry' }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <PrimaryButton label={retryLabel} onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xxxl,
  },
  message: {
    color: theme.colors.danger,
    fontSize: theme.type.small.size,
    textAlign: 'center',
  },
});
