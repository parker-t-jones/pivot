import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../lib/theme';
import { TextButton } from './TextButton';

/**
 * Persistent banner for the demo game day (§12.2) — stays on screen for the whole demo so it can
 * never be mistaken for the real app.
 */
export function DemoBanner({ onExit }: { onExit: () => void }) {
  // The banner is the top edge of the screen, so it clears the status bar and Dynamic Island itself.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { paddingTop: insets.top + theme.spacing.sm }]}>
      <Text style={styles.label}>DEMO — not a real game</Text>
      <TextButton label="Exit" labelStyle={styles.exitLabel} onPress={onExit} size="smallStrong" />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  exitLabel: {
    color: theme.colors.background,
    fontWeight: '700',
  },
  label: {
    color: theme.colors.background,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
});
