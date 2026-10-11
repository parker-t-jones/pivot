import { StyleSheet, Text, View } from 'react-native';

import type { WeekCardModel } from '../lib/weekCardModel';
import { theme } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { Slip } from './Slip';
import { SlipPerforation } from './SlipPerforation';

interface WeekCardProps {
  model: WeekCardModel;
  onAddStake: () => void;
}

/**
 * Watchlist week card (PIVOT-STAKES-PLAN.md §11.4): a 2×2 grid, perforation, then Add a stake.
 */
export function WeekCard({ model, onAddStake }: WeekCardProps) {
  return (
    <Slip style={styles.slip}>
      <View style={styles.grid}>
        <Cell cell={model.fantasy} />
        <Cell cell={model.opponent} />
        <Cell cell={model.bets} />
        <Cell cell={model.pools} />
      </View>
      <SlipPerforation style={styles.perforation} />
      <View style={styles.footer}>
        <PrimaryButton label="Add a stake" onPress={onAddStake} />
      </View>
    </Slip>
  );
}

function Cell({ cell }: { cell: WeekCardModel['fantasy'] }) {
  return (
    <View style={styles.cell}>
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
    </View>
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
