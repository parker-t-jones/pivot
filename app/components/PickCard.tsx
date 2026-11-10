import { StyleSheet, Text, View } from 'react-native';

import type { PickCardModel } from '../lib/pickCard';
import { theme } from '../lib/theme';
import { LineScale } from './StakeCards';
import { TeamBadge } from './TeamBadge';

interface PickCardProps {
  model: PickCardModel;
}

/**
 * One Watchlist card per non-fantasy pick (issue #13). Type eyebrow and the pick in
 * accent on the left, matchup and kickoff/status on the right, a progress bar while
 * live, and a dimmed final. Removal is a swipe on the phone Watchlist (`SwipeToRemove`), so the
 * card has no Remove button (issue #14).
 */
export function PickCard({ model }: PickCardProps) {
  const final = model.phase === 'final';
  const live = model.phase === 'live';
  return (
    <View style={[styles.card, model.hit && styles.cardHit]} testID={`pick-card-${model.phase}`}>
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
            // A prop label ("P. Mahomes under 274.5 pass yds") can need a second line on a phone.
            numberOfLines={2}
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
      {model.detail ? (
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          style={[styles.detail, final && styles.statusFinal, model.hit && styles.detailHit]}
          testID="pick-card-detail"
        >
          {model.detail}
        </Text>
      ) : null}
      {model.legs.length > 0 ? (
        <View style={styles.legs} testID="pick-card-legs">
          {model.legs.map((leg, index) => (
            <View key={leg.key} style={styles.leg} testID="pick-card-leg">
              <View style={styles.legTop}>
                <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.legLabel}>
                  {`LEG ${index + 1}`}
                </Text>
                {leg.state ? (
                  <Text
                    maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                    style={[styles.legState, leg.state === 'Live' && styles.statusLive]}
                  >
                    {leg.state}
                  </Text>
                ) : null}
              </View>
              <Text
                maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                style={[styles.legPick, final && styles.pickFinal]}
              >
                {leg.pick}
              </Text>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.legMeta}>
                {[leg.matchup, leg.status, leg.detail]
                  .filter((part): part is string => part != null && part.length > 0)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {live && model.bar ? (
        <View
          accessibilityLabel={`${model.bar.current} of ${model.bar.line}`}
          style={styles.barTrack}
          testID="pick-card-bar"
        >
          <View
            style={[
              styles.barFill,
              model.hit && styles.barFillHit,
              { width: `${Math.round(model.bar.fill * 100)}%` },
            ]}
            testID={model.hit ? 'pick-card-bar-fill-hit' : 'pick-card-bar-fill'}
          />
        </View>
      ) : null}
      {live && model.progress ? (
        <View testID="pick-card-progress">
          <LineScale axisLabel={model.axisLabel} model={model.progress} />
        </View>
      ) : null}
    </View>
  );
}

const BAR_HEIGHT = 6;

const styles = StyleSheet.create({
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
  // A hit pick keeps the amber flare glow and stroke after the PickEventFlash fades.
  cardHit: {
    ...theme.effects.flareGlow,
    borderColor: theme.colors.accentBorder,
  },
  barFill: {
    backgroundColor: theme.colors.accent,
    borderRadius: BAR_HEIGHT / 2,
    height: BAR_HEIGHT,
  },
  barFillHit: {
    backgroundColor: theme.colors.success,
  },
  barTrack: {
    backgroundColor: theme.colors.border,
    borderRadius: BAR_HEIGHT / 2,
    height: BAR_HEIGHT,
    overflow: 'hidden',
  },
  detailHit: {
    color: theme.colors.success,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  detail: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.small.size,
    lineHeight: theme.type.small.lineHeight,
  },
  gameCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: theme.spacing.xs,
  },
  leg: {
    borderColor: theme.colors.border,
    borderTopWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
  },
  legLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  legMeta: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  legPick: {
    color: theme.colors.accent,
    fontSize: theme.type.bodyStrong.size,
    fontWeight: theme.type.bodyStrong.weight,
    lineHeight: theme.type.bodyStrong.lineHeight,
  },
  legState: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
  },
  legTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legs: {
    gap: theme.spacing.sm,
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
