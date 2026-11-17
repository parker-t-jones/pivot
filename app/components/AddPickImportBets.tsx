import { StyleSheet, Text, View } from 'react-native';

import { importBetHeader, type ImportBetChoice } from '../lib/slipImport';
import { theme } from '../lib/theme';
import { ListRow } from './ListRow';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';
import { TextButton } from './TextButton';

/**
 * The review for a screenshot with more than one bet (or one the API wasn't sure how to split).
 * Legs sit under a header per bet ("Bet 1 · Parlay · 3 legs"). The user selects the legs to add;
 * each selected bet saves on its own, as a pick or a parlay. Free accounts choose up to the picks
 * they have left across all bets, since every leg uses one pick. Legs Pivot couldn't match are
 * shown with the reason and are never added.
 */
export function AddPickImportBets({
  bets,
  selected,
  limit,
  review,
  disabled,
  saving,
  error,
  onToggle,
  onSave,
  onUpgrade,
}: {
  bets: readonly ImportBetChoice[];
  selected: readonly string[];
  /** Free picks left this week, or null for Pro (no limit). */
  limit: number | null;
  /** The API wasn't sure of the grouping: say so, and nothing starts selected. */
  review: boolean;
  disabled: boolean;
  saving: boolean;
  error: string | null;
  onToggle: (key: string) => void;
  onSave: () => void;
  onUpgrade: () => void;
}) {
  const total = bets.reduce((sum, bet) => sum + bet.legs.length, 0);
  const count = selected.length;
  const full = limit !== null && count >= limit;
  const hasFlagged = bets.some((bet) => bet.flagged.length > 0);

  return (
    <View style={styles.stack} testID="add-pick-import-bets">
      <Text style={styles.body}>
        {review
          ? 'We weren’t sure how this screenshot splits into bets. Check each pick, and select only the ones that match your slip.'
          : `We found ${bets.length} bets in your screenshot. Check each pick, and deselect any that are wrong.`}
      </Text>
      {limit !== null ? (
        <Text style={styles.body}>
          {`You have ${limit} free ${limit === 1 ? 'pick' : 'picks'} left this week. Each leg uses one pick, so choose up to ${limit} of these ${total} legs.`}
        </Text>
      ) : null}
      {hasFlagged ? (
        <Text style={styles.body}>
          We couldn’t match some legs, so they won’t be added. You can add them yourself afterward.
        </Text>
      ) : null}

      {bets.map((bet, index) => (
        <View key={bet.key} style={styles.bet} testID="add-pick-import-bet">
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.header}>
            {importBetHeader(index, bet)}
          </Text>
          {bet.legs.map((leg) => {
            const on = selected.includes(leg.key);
            const blocked = !on && full;
            return (
              <ListRow
                key={leg.key}
                title={leg.label}
                subtitle={
                  blocked
                    ? limit === 0
                      ? 'You have no free picks left this week.'
                      : 'Deselect a leg to free a pick.'
                    : `Your slip says “${leg.printed}”.`
                }
                trailing={
                  <SecondaryButton
                    accessibilityLabel={`${on ? 'Deselect' : 'Select'} ${leg.label}`}
                    disabled={disabled || saving || blocked}
                    label={on ? 'Deselect' : 'Select'}
                    onPress={() => onToggle(leg.key)}
                  />
                }
              />
            );
          })}
          {bet.flagged.map((leg) => (
            <ListRow
              key={leg.key}
              subtitle={`${leg.reason} This leg won’t be added.`}
              title={leg.text}
            />
          ))}
        </View>
      ))}

      {error ? (
        <Text style={styles.error} testID="add-pick-import-bets-error">
          {error}
        </Text>
      ) : null}
      {limit !== null ? <TextButton label="Upgrade to Pro" onPress={onUpgrade} /> : null}
      <PrimaryButton
        disabled={disabled || count === 0 || (limit !== null && count > limit)}
        label={count === 1 ? 'Add 1 pick' : `Add ${count} picks`}
        loading={saving}
        onPress={onSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bet: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  body: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  header: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  stack: {
    gap: theme.spacing.md,
  },
});
