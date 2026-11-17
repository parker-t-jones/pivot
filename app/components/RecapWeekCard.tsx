import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RecapPickLine, RecapWeekModel } from '../lib/recapHistory';
import { theme } from '../lib/theme';

/**
 * Width of the "Best pick" / "Worst pick" label column, so both values start at the same x and
 * wrap inside the card. Fits "Worst pick" at the dense Dynamic Type cap
 * (`theme.fontScaleCaps.dense`) in `theme.type.small`.
 */
export const RECAP_LABEL_COLUMN_WIDTH = 96;

interface RecapWeekCardProps {
  model: RecapWeekModel;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One past week on the Recap screen. Same expand-in-place pattern as `FantasyLeagueCard` on the
 * Watchlist's All tab: collapsed shows the week and its hit rate; tap shows best/worst and every
 * pick that week with its result.
 */
export function RecapWeekCard({ model, expanded, onToggle }: RecapWeekCardProps) {
  return (
    <View style={styles.card} testID={`recap-week-${model.week}`}>
      <Pressable
        accessibilityHint={expanded ? 'Hides the picks.' : 'Shows the picks.'}
        accessibilityLabel={`Week ${model.week}, ${model.weekLine}`}
        accessibilityRole="button"
        aria-expanded={expanded}
        onPress={onToggle}
        style={styles.header}
        testID="recap-week-toggle"
      >
        <View style={styles.copy}>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
            {model.eyebrow}
          </Text>
          <Text style={styles.headline} testID="recap-week-line">
            {model.weekLine}
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          style={[styles.toggleLabel, expanded && styles.toggleLabelOpen]}
        >
          {expanded ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body} testID="recap-week-body">
          {model.bestLabel ? (
            <RecapDetailRow
              label="Best pick"
              testID="recap-best"
              tone="won"
              value={model.bestLabel}
            />
          ) : null}
          {model.worstLabel ? (
            <RecapDetailRow
              label="Worst pick"
              testID="recap-worst"
              tone="lost"
              value={model.worstLabel}
            />
          ) : null}
          {model.picks.length > 0 ? (
            <>
              {model.bestLabel || model.worstLabel ? <View style={styles.divider} /> : null}
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
                ALL PICKS
              </Text>
              {model.picks.map((pick) => (
                <RecapPickResultRow key={pick.id} pick={pick} />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Label column of fixed width, value filling the rest and wrapping. The old row used
 * `justifyContent: 'space-between'` with an unshrinkable value, which ran a long value off the
 * card on iOS and left no gap after the label.
 */
export function RecapDetailRow({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: string;
  tone: 'won' | 'lost';
  testID: string;
}) {
  return (
    <View style={styles.detailRow} testID={`${testID}-row`}>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        style={styles.detailLabel}
        testID={`${testID}-label`}
      >
        {label}
      </Text>
      <Text style={[styles.detailValue, tone === 'won' ? styles.won : styles.lost]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function RecapPickResultRow({ pick }: { pick: RecapPickLine }) {
  return (
    <View style={styles.pickRow} testID={`recap-pick-${pick.id}`}>
      <Text style={styles.pickLabel} testID="recap-pick-label">
        {pick.label}
      </Text>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        style={[
          styles.pickResult,
          pick.tone === 'won' ? styles.won : pick.tone === 'lost' ? styles.lost : styles.neutral,
        ]}
        testID="recap-pick-result"
      >
        {pick.resultLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  copy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  detailLabel: {
    color: theme.colors.textSecondary,
    flexShrink: 0,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
    width: RECAP_LABEL_COLUMN_WIDTH,
  },
  detailRow: {
    alignItems: 'flex-start',
    columnGap: theme.spacing.md,
    flexDirection: 'row',
  },
  detailValue: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: theme.type.small.size,
    fontWeight: theme.type.smallStrong.weight,
    lineHeight: theme.type.small.lineHeight,
    minWidth: 0,
  },
  divider: {
    backgroundColor: theme.colors.border,
    height: theme.effects.panelBorderWidth,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  headline: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    lineHeight: theme.type.heading.lineHeight,
  },
  lost: {
    color: theme.colors.danger,
  },
  neutral: {
    color: theme.colors.textSecondary,
  },
  pickLabel: {
    color: theme.colors.textPrimary,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
    minWidth: 0,
  },
  pickResult: {
    flexShrink: 0,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
    lineHeight: theme.type.smallStrong.lineHeight,
    textAlign: 'right',
  },
  pickRow: {
    alignItems: 'flex-start',
    columnGap: theme.spacing.md,
    flexDirection: 'row',
  },
  toggleLabel: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
    lineHeight: theme.type.smallStrong.lineHeight,
  },
  toggleLabelOpen: {
    color: theme.colors.accent,
  },
  won: {
    color: theme.colors.success,
  },
});
