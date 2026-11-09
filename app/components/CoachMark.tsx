import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import { TextButton } from './TextButton';

interface CoachMarkProps {
  text: string;
  onDismiss: () => void;
}

/**
 * One-time tooltip (§12.2): Home's segmented control, the Watchlist week card, and Settings'
 * "Replay tour" link. Callers decide whether to show it (`pickCoachMarkToShow` against
 * `preferences.seenCoachMarks`) and write the dismissal back through `patchPreferences`.
 */
export function CoachMark({ text, onDismiss }: CoachMarkProps) {
  return (
    <View style={styles.bubble}>
      <Text style={styles.text}>{text}</Text>
      <TextButton label="Got it" onPress={onDismiss} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: theme.colors.surfaceRaised,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'space-between',
    padding: theme.spacing.md,
  },
  text: {
    color: theme.colors.textSecondary,
    flex: 1,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
});
