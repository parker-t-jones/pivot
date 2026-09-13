import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';
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
export function EmptyState({
  title,
  message,
  primaryAction,
  secondaryAction,
  children,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
      {primaryAction ? (
        <PrimaryButton
          label={primaryAction.label}
          onPress={primaryAction.onPress}
          style={styles.primary}
        />
      ) : null}
      {secondaryAction ? (
        <TextButton
          hitArea="padding"
          label={secondaryAction.label}
          onPress={secondaryAction.onPress}
          size="smallStrong"
          tone="muted"
          underline
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xxxl,
  },
  message: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
    textAlign: 'center',
  },
  primary: {
    marginTop: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    textAlign: 'center',
  },
});
