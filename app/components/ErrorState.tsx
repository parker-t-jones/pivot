import { Pressable, StyleSheet, Text, View } from 'react-native';

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
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  container: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  message: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
  },
});
