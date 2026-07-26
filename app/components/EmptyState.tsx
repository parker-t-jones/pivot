import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';

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
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 40,
  },
  message: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: 10,
    marginTop: theme.spacing.sm,
    minWidth: 200,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: theme.colors.onAccent,
    fontSize: theme.type.body.size,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
    textDecorationLine: 'underline',
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    textAlign: 'center',
  },
});
