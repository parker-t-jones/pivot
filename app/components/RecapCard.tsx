import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from './EmptyState';
import type { RecapCardModel } from '../lib/recapCard';
import { theme } from '../lib/theme';

/**
 * Weekly recap (issue #47): picks made, hit rate, the week's best and worst graded pick, and
 * season-to-date hit rate. Pure presentational — `recap.tsx` fetches `GET /picks/recap` and
 * builds the model with `recapCardModel`.
 */
export function RecapCard({ model }: { model: RecapCardModel }) {
  if (model.isEmpty) {
    return (
      <EmptyState
        title="Nothing graded yet"
        message="Add a pick before kickoff. Once the games are final, your week shows up right here."
      />
    );
  }

  return (
    <View style={styles.card} testID="recap-card">
      <Text style={styles.eyebrow}>WEEK {model.week}</Text>
      <Text style={styles.headline} testID="recap-week-line">
        {model.weekLine ?? 'Nothing decided yet this week'}
      </Text>
      {model.bestLabel ? (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Best pick</Text>
          <Text style={[styles.rowValue, styles.won]} testID="recap-best">
            {model.bestLabel}
          </Text>
        </View>
      ) : null}
      {model.worstLabel ? (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Worst pick</Text>
          <Text style={[styles.rowValue, styles.lost]} testID="recap-worst">
            {model.worstLabel}
          </Text>
        </View>
      ) : null}
      <View style={styles.divider} />
      <Text style={styles.seasonLine} testID="recap-season-line">
        {model.seasonLine ?? 'No season-to-date picks decided yet'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    ...theme.effects.panelGlow,
  },
  divider: {
    backgroundColor: theme.colors.border,
    height: 1,
    marginVertical: theme.spacing.xs,
  },
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  headline: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  lost: {
    color: theme.colors.danger,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
  },
  rowValue: {
    fontSize: theme.type.body.size,
    fontWeight: theme.type.button.weight,
  },
  seasonLine: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
  },
  won: {
    color: theme.colors.success,
  },
});
