import { useRouter } from 'expo-router';

import { HOME_SEGMENTS, type HomeSegmentKey } from '../lib/homeSegment';
import { SegmentedControl } from './SegmentedControl';
import { TextButton } from './TextButton';

/** "Manage" → Lineup tab (the Watchlist rename waits for stakes Phase 3, §11.4). */
export function ManageLineupLink() {
  const router = useRouter();
  return (
    <TextButton
      accessibilityLabel="Manage lineup"
      accessibilityRole="link"
      label="Manage"
      onPress={() => router.push('/(app)/(tabs)/lineup')}
      size="smallStrong"
    />
  );
}

interface HomeSegmentRowProps {
  segment: HomeSegmentKey;
  onChange: (key: string) => void;
}

/** BOARD | MY CARD, full width in both segments. */
export function HomeSegmentRow({ segment, onChange }: HomeSegmentRowProps) {
  return <SegmentedControl segments={[...HOME_SEGMENTS]} value={segment} onChange={onChange} />;
}
