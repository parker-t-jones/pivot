import { StyleSheet, Text, View } from 'react-native';

import { DESKTOP_RIGHT_COLUMN } from '../lib/desktopLayout';
import { theme } from '../lib/theme';
import { useDesktopTier } from '../lib/useDesktopTier';
import { Skeleton, SkeletonGroup } from './Skeleton';
import { TextButton } from './TextButton';

/** Representative single-line cards: actual heights grow with picks and Dynamic Type. */
export function ColdLoading({
  screen,
  slow,
  onRetry,
}: {
  screen: 'home' | 'watchlist';
  slow: boolean;
  onRetry: () => void;
}) {
  const tier = useDesktopTier();
  const split = screen === 'home' && tier !== 'companion';
  const rows = (
    <View style={styles.stack}>
      <Skeleton style={screen === 'home' ? styles.boardRow : styles.pickRow} />
      <Skeleton style={screen === 'home' ? styles.boardRow : styles.pickRow} />
    </View>
  );
  return (
    <View style={styles.stack} testID={`${screen}-cold-loading`}>
      <SkeletonGroup>
        <View style={[styles.stack, split && styles.split]}>
          <View style={styles.main}>
            <Skeleton style={screen === 'home' ? styles.hero : styles.week} />
            {rows}
          </View>
          {split ? (
            <View style={styles.side}>
              <Skeleton style={styles.pickRow} />
              <Skeleton style={styles.pickRow} />
            </View>
          ) : null}
        </View>
      </SkeletonGroup>
      {slow ? (
        <View style={styles.message}>
          <Text style={styles.text}>This is taking longer than usual.</Text>
          <TextButton label="Retry" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.spacing.lg, width: '100%' },
  split: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 0, gap: theme.spacing.lg },
  side: { width: DESKTOP_RIGHT_COLUMN, gap: theme.spacing.lg },
  // FeaturedStakeCard: band, lg body padding, eyebrow/title/chip and two md gaps.
  hero: {
    height:
      theme.spacing.xs +
      theme.spacing.lg * 2 +
      theme.type.caption.lineHeight +
      theme.type.title.lineHeight +
      theme.type.caption.lineHeight +
      theme.spacing.xs * 2 +
      theme.spacing.md * 2 +
      theme.effects.panelBorderWidth * 2,
  },
  // WeekCard: header, two grid rows, perforation gutters and Add a pick footer.
  week: {
    height:
      theme.spacing.lg * 5 +
      theme.type.caption.lineHeight +
      (theme.type.eyebrow.size + theme.spacing.xs + theme.type.body.lineHeight) * 2 +
      theme.spacing.md +
      theme.spacing.md2 * 2 +
      theme.spacing.md2 +
      theme.type.button.lineHeight +
      theme.effects.panelBorderWidth * 2,
  },
  boardRow: { height: theme.spacing.xxxl },
  // PickCard: lg padding, eyebrow + xs gap + heading, enclosing border.
  pickRow: {
    height:
      theme.spacing.lg * 2 +
      theme.type.caption.lineHeight +
      theme.spacing.xs +
      theme.type.heading.lineHeight +
      theme.effects.panelBorderWidth * 2,
  },
  message: { alignItems: 'center', gap: theme.spacing.sm },
  text: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
});
