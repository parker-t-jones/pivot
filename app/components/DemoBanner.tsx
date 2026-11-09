import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { TextButton } from './TextButton';

/**
 * Persistent banner for the demo game day (§12.2) — stays on screen for the whole demo so it can
 * never be mistaken for the real app.
 */
export function DemoBanner({ onExit }: { onExit: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.label}>DEMO — not a real game</Text>
      <TextButton
        label="Exit"
        labelStyle={styles.exitLabel}
        onPress={onExit}
        size="smallStrong"
      />
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
    paddingVertical: theme.spacing.sm,
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
