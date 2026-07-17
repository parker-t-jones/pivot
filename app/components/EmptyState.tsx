import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

interface EmptyStateProps {
  title: string;
  message?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  children?: ReactNode;
}

/**
 * Sprint 9 Phase 2 — one shared shape for every "nothing here yet" screen (Home States 2/4/5,
 * Settings' empty Leagues list, onboarding's connect-team prompt) instead of each screen inventing
 * its own muted-text block. Deliberately plain (no illustration/icon system exists yet in this
 * codebase) — consistent typography/spacing is the win here, not visual richness.
 */
export function EmptyState({ title, message, primaryAction, secondaryAction, children }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
      {primaryAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={primaryAction.onPress}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>{primaryAction.label}</Text>
        </Pressable>
      ) : null}
      {secondaryAction ? (
        <Pressable accessibilityRole="button" onPress={secondaryAction.onPress}>
          <Text style={styles.secondaryButtonText}>{secondaryAction.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 40,
  },
  message: {
    color: '#8e8e93',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 10,
    marginTop: 8,
    minWidth: 200,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#8e8e93',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
    textDecorationLine: 'underline',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
