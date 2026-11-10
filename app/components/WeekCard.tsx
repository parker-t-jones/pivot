import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { theme } from '../lib/theme';
import type { WeekCardCell, WeekCardModel } from '../lib/weekCardModel';
import { PrimaryButton } from './PrimaryButton';
import { Slip } from './Slip';
import { SlipPerforation } from './SlipPerforation';
import { TextButton } from './TextButton';

interface WeekCardProps {
  model: WeekCardModel;
  onAddStake: () => void;
  onOpponentToggle?: () => void;
  editsLocked?: boolean;
  /** Share a branded image of this card (issue #48). Omit to hide the action. */
  onShare?: () => void;
}

/**
 * Watchlist week card (PIVOT-STAKES-PLAN.md §11.4, issue #13): "YOUR WEEK n CARD" and the
 * game count, a labeled 2×2 grid, a card-edge perforation, then Add a pick.
 */
export function WeekCard({
  model,
  onAddStake,
  onOpponentToggle,
  editsLocked = false,
  onShare,
}: WeekCardProps) {
  const { openUpgrade } = useUpgradeSheet();
  return (
    <Slip style={styles.slip}>
      <View style={styles.head}>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.eyebrow}
        >
          {model.eyebrow}
        </Text>
        <View style={styles.headRight}>
          {model.gameCountLabel ? (
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              numberOfLines={1}
              style={styles.gameCount}
            >
              {model.gameCountLabel}
            </Text>
          ) : null}
          {onShare ? (
            <TextButton
              accessibilityLabel="Share your week card"
              hitArea="padding"
              label="Share"
              onPress={onShare}
              size="smallStrong"
              tone="muted"
            />
          ) : null}
        </View>
      </View>
      <View style={styles.grid}>
        <Cell cell={model.fantasy} />
        <Cell
          cell={model.opponent}
          onPress={model.opponent.toggleable && !editsLocked ? onOpponentToggle : undefined}
        />
        <Cell cell={model.bets} onUpgrade={model.bets.upgrade ? () => openUpgrade() : undefined} />
        <Cell cell={model.pools} />
      </View>
      <SlipPerforation above="background" edge="card" style={styles.perforation} />
      <View style={styles.footer}>
        <PrimaryButton disabled={editsLocked} label="Add a pick" onPress={onAddStake} />
      </View>
    </Slip>
  );
}

function Cell({
  cell,
  onUpgrade,
  onPress,
}: {
  cell: WeekCardCell;
  onUpgrade?: () => void;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        numberOfLines={1}
        style={styles.label}
      >
        {cell.label}
      </Text>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        numberOfLines={2}
        style={[styles.value, cell.muted && styles.valueMuted]}
      >
        {cell.value}
      </Text>
      {cell.note ? (
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={[styles.note, cell.accent && styles.noteAccent]}
        >
          {cell.note}
        </Text>
      ) : null}
      {onUpgrade ? <TextButton label="Upgrade" onPress={onUpgrade} size="small" /> : null}
    </>
  );
  if (!onPress) return <View style={styles.cell}>{body}</View>;
  return (
    <Pressable
      accessibilityLabel={`${cell.label}, ${cell.value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.cell}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    gap: theme.spacing.xs,
    width: '50%',
  },
  eyebrow: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  footer: {
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  gameCount: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    rowGap: theme.spacing.md,
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  headRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  note: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
  },
  noteAccent: {
    color: theme.colors.accent,
  },
  label: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  perforation: {
    marginVertical: theme.spacing.lg,
  },
  slip: {
    overflow: 'visible',
  },
  value: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
  valueMuted: {
    color: theme.colors.textTertiary,
  },
});
