import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { YardLineLoader } from './YardLineLoader';

interface LoadingStateProps {
  message?: string;
  /** Renders inline (no `flex: 1`/centered-fill wrapper) for use inside a scroll view alongside
   *  other content, e.g. Home's cold-start spinner — as opposed to a full-screen gate. */
  inline?: boolean;
}

/** Sprint 9 Phase 2 shared loading block — see `EmptyState.tsx`'s docstring for why this exists as
 *  its own component now instead of every screen's own `ActivityIndicator` + `Text` pair. */
export function LoadingState({ message = 'Loading…', inline = false }: LoadingStateProps) {
  return (
    <View style={inline ? styles.inline : styles.fill}>
      <YardLineLoader size={inline ? 'section' : 'screen'} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
  },
  inline: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xxxl,
  },
  text: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
    textAlign: 'center',
  },
});
