import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/fonts';
import { HOME_SEGMENTS, type HomeSegmentKey } from '../lib/homeSegment';
import { theme } from '../lib/theme';
import { SegmentedControl } from './SegmentedControl';

/** "Manage" → Lineup tab (the Watchlist rename waits for stakes Phase 3, §11.4). */
export function ManageLineupLink() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Manage lineup"
      onPress={() => router.push('/(app)/(tabs)/lineup')}
      hitSlop={8}
    >
      <Text style={styles.manageLink}>Manage</Text>
    </Pressable>
  );
}

interface HomeSegmentRowProps {
  segment: HomeSegmentKey;
  onChange: (key: string) => void;
}

/** BOARD | MY CARD, with the Manage link on the right while MY CARD is selected. */
export function HomeSegmentRow({ segment, onChange }: HomeSegmentRowProps) {
  return (
    <View style={styles.segmentRow}>
      <View style={styles.segmentControl}>
        <SegmentedControl segments={[...HOME_SEGMENTS]} value={segment} onChange={onChange} />
      </View>
      {segment === 'my_card' ? <ManageLineupLink /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  manageLink: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  segmentControl: {
    flex: 1,
  },
  segmentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
});
