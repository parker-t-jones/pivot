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
}

/**
 * Watchlist week card (PIVOT-STAKES-PLAN.md §11.4): a 2×2 grid, perforation, then Add a pick.
 */
export function WeekCard({
  model,
  onAddStake,
  onOpponentToggle,
  editsLocked = false,
}: WeekCardProps) {
  const { openUpgrade } = useUpgradeSheet();
  return (
    <Slip style={styles.slip}>
      <View style={styles.grid}>
        <Cell cell={model.fantasy} />
        <Cell
          cell={model.opponent}
          onPress={model.opponent.toggleable && !editsLocked ? onOpponentToggle : undefined}
        />
        <Cell cell={model.bets} onUpgrade={model.bets.upgrade ? () => openUpgrade() : undefined} />
        <Cell cell={model.pools} />
      </View>
      <SlipPerforation style={styles.perforation} />
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
        style={[styles.value, cell.accent && styles.valueAccent, cell.muted && styles.valueMuted]}
      >
        {cell.value}
      </Text>
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
  footer: {
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    rowGap: theme.spacing.md,
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
  valueAccent: {
    color: theme.colors.accent,
  },
  valueMuted: {
    color: theme.colors.textTertiary,
  },
});
