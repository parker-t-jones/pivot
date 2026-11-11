import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

export function FlagChip({ label }: { label: string }) {
  return (
    <View style={styles.reasonChip}>
      <View style={styles.reasonChipPlayers}>
        <Text style={styles.reasonChipText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reasonChip: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    overflow: 'hidden',
    paddingVertical: theme.spacing.sm,
    shadowColor: theme.colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  reasonChipPlayers: {
    flex: 3,
    paddingHorizontal: theme.spacing.md,
  },
  reasonChipText: {
    color: theme.colors.accent,
    fontFamily: fonts.monoSemiBold,
    fontSize: theme.type.caption.size,
    fontWeight: '600',
  },
});
