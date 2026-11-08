import { StyleSheet, Text, View } from 'react-native';

import type { PickCardModel } from '../lib/pickCard';
import { theme } from '../lib/theme';
import { LineScale } from './StakeCards';
import { TeamBadge } from './TeamBadge';
import { TextButton } from './TextButton';

interface PickCardProps {
  model: PickCardModel;
  /** Omitted when edits are locked (demo account). */
  onRemove?: () => void;
}

/**
 * One Watchlist card per non-fantasy pick (issue #13). Type eyebrow and the pick in
 * accent on the left, matchup and kickoff/status on the right, a progress bar while
 * live, and a dimmed final.
 */
export function PickCard({ model, onRemove }: PickCardProps) {
  const final = model.phase === 'final';
  const live = model.phase === 'live';
  return (
    <View style={styles.card} testID={`pick-card-${model.phase}`}>
      <View style={styles.top}>
        <View style={styles.pickCol}>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.eyebrow}
          >
            {model.eyebrow}
          </Text>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={[styles.pick, final && styles.pickFinal]}
            testID="pick-card-pick"
          >
            {model.pick}
          </Text>
        </View>
        <View style={styles.gameCol}>
          {model.awayTeam && model.homeTeam ? (
            <View accessibilityLabel={model.matchup} style={styles.matchup}>
              <TeamBadge abbr={model.awayTeam} size="sm" />
              <Text style={styles.at}>@</Text>
              <TeamBadge abbr={model.homeTeam} size="sm" />
            </View>
          ) : null}
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={[styles.status, live && styles.statusLive, final && styles.statusFinal]}
            testID="pick-card-status"
          >
            {model.status}
          </Text>
        </View>
      </View>
      {live && model.progress ? (
        <View testID="pick-card-progress">
          <LineScale axisLabel={model.axisLabel} model={model.progress} />
        </View>
      ) : null}
      {onRemove ? (
        <View style={styles.actions}>
          <TextButton label="Remove" onPress={onRemove} tone="danger" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'flex-start',
  },
  at: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  gameCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: theme.spacing.xs,
  },
  matchup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  pick: {
    color: theme.colors.accent,
    fontFamily: theme.type.heading.fontFamily,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
    lineHeight: theme.type.heading.lineHeight,
  },
  pickCol: {
    flex: 1,
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  pickFinal: {
    color: theme.colors.textTertiary,
  },
  status: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
  },
  statusFinal: {
    color: theme.colors.textTertiary,
  },
  statusLive: {
    color: theme.colors.flare,
  },
  top: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
});
