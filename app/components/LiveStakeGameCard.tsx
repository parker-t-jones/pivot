import { StyleSheet, Text, View } from 'react-native';

import {
  fieldAlignedMatchup,
  opponentAbbreviation,
  watchOptionParts,
  type GameBroadcast,
} from '../lib/gameDisplay';
import { fonts } from '../lib/fonts';
import {
  fieldSideAbbreviations,
  liveCardClock,
  type LiveStakeCardModel,
  type LiveStakeChip,
} from '../lib/liveStakeCards';
import type { LiveGame } from '../lib/schedule';
import { scoreBlockWash } from '../lib/teamColors';
import { theme } from '../lib/theme';
import { FieldGauge } from './FieldGauge';
import { OtherWaysToWatch } from './OtherWaysToWatch';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

interface LiveStakeGameCardProps {
  model: LiveStakeCardModel;
  /** In-market local route under the watch button, same as Now Active. */
  localRoute?: GameBroadcast | null;
  onSwitch: (game: LiveGame) => void;
  onSwitchLocal?: (broadcast: GameBroadcast) => void;
}

/**
 * One staked live game. The top card is NOW ACTIVE when a stake is active, or
 * LIVE · YOUR GAME when none is. The watch button is filled amber only while a
 * stake in this game is active.
 */
export function LiveStakeGameCard({
  model,
  localRoute = null,
  onSwitch,
  onSwitchLocal,
}: LiveStakeGameCardProps) {
  const { game } = model;
  const matchup = fieldAlignedMatchup(game);
  const sides = fieldSideAbbreviations(game);
  const underlay = theme.colors.background;
  const leftWash = scoreBlockWash(sides.left, underlay);
  const rightWash = scoreBlockWash(sides.right, underlay);
  const showGauge = game.yards_to_endzone !== null;
  const opponentTeam = opponentAbbreviation(game.possession_team, game.home_team, game.away_team);

  return (
    <View style={[styles.card, model.active && styles.cardActive]}>
      {model.eyebrow ? <Text style={styles.eyebrow}>{model.eyebrow}</Text> : null}

      <View style={styles.matchupRow}>
        <View style={[styles.sideChip, { backgroundColor: leftWash }]} testID="live-score-left">
          <Text style={[styles.teamName, styles.teamLeft]} numberOfLines={1}>
            {matchup.leftName}
          </Text>
          <Text style={styles.score}>{matchup.leftScore}</Text>
        </View>
        <View style={styles.scoreDivider} />
        <View style={[styles.sideChip, { backgroundColor: rightWash }]} testID="live-score-right">
          <Text style={styles.score}>{matchup.rightScore}</Text>
          <Text style={[styles.teamName, styles.teamRight]} numberOfLines={1}>
            {matchup.rightName}
          </Text>
        </View>
      </View>

      {showGauge ? (
        <FieldGauge
          yardsToEndzone={game.yards_to_endzone}
          possessionTeam={game.possession_team}
          opponentTeam={opponentTeam}
          down={game.down}
          distance={game.distance}
          quarter={game.quarter}
          timeRemainingSec={game.time_remaining_sec}
        />
      ) : (
        <Text style={styles.clockOnly}>{liveCardClock(game)}</Text>
      )}

      {model.chips.length > 0 ? (
        <View style={styles.chips}>
          {model.chips.map((chip) => (
            <StakeChip key={chip.key} chip={chip} />
          ))}
          {model.extraChips > 0 ? (
            <View style={[styles.chip, styles.chipNeutral]}>
              <Text style={styles.chipNeutralText}>{`+${model.extraChips}`}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {model.opensLink === false ? (
        <Text style={styles.airing}>{model.buttonLabel}</Text>
      ) : (
        <View style={styles.cta}>
          <PrimaryButton
            label={model.buttonLabel}
            onPress={() => onSwitch(game)}
            variant={model.active ? 'filled' : 'outlined'}
            labelStyle={styles.ctaLabel}
          />
          {model.alternates && model.alternates.length > 0 && onSwitchLocal ? (
            <OtherWaysToWatch alternates={model.alternates} onOpen={onSwitchLocal} />
          ) : localRoute && onSwitchLocal ? (
            <SecondaryButton
              caption={watchOptionParts(localRoute).caption}
              label={watchOptionParts(localRoute).title}
              onPress={() => onSwitchLocal(localRoute)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function StakeChip({ chip }: { chip: LiveStakeChip }) {
  const onField = chip.tone === 'on_field';
  const sidelined = chip.tone === 'sideline';
  return (
    <View
      style={[
        styles.chip,
        onField && styles.chipOnField,
        sidelined && styles.chipSideline,
        chip.tone === 'neutral' && styles.chipNeutral,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          onField && styles.chipOnFieldText,
          sidelined && styles.chipSidelineText,
          chip.tone === 'neutral' && styles.chipNeutralText,
        ]}
      >
        {chip.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: theme.spacing.md,
    width: '100%',
  },
  sectionLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.hero,
    borderWidth: theme.effects.panelBorderWidth,
    gap: theme.spacing.md,
    padding: theme.spacing.lg2,
    width: '100%',
  },
  cardActive: {
    borderColor: theme.colors.accentBorder,
    ...theme.effects.panelGlow,
  },
  chip: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  chipNeutral: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  chipNeutralText: {
    color: theme.colors.textSecondary,
  },
  chipOnField: {
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accent,
  },
  chipOnFieldText: {
    color: theme.colors.accent,
  },
  chipSideline: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  chipSidelineText: {
    color: theme.colors.textTertiary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  chipText: {
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  clockOnly: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  airing: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
    marginTop: theme.spacing.sm,
  },
  cta: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  ctaLabel: {
    fontFamily: fonts.teamNickname,
    fontWeight: '400',
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  score: {
    color: theme.colors.textPrimary,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: theme.type.score.size,
    fontVariant: [...theme.type.score.fontVariant],
    letterSpacing: theme.type.score.letterSpacing,
    lineHeight: theme.type.score.lineHeight,
    minWidth: 28,
    textAlign: 'center',
  },
  scoreDivider: {
    backgroundColor: theme.colors.border,
    height: 22,
    marginHorizontal: theme.spacing.xs,
    width: StyleSheet.hairlineWidth * 2,
  },
  sideChip: {
    alignItems: 'center',
    borderRadius: theme.radii.sm,
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  teamLeft: {
    flexShrink: 1,
    textAlign: 'left',
  },
  teamName: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  teamRight: {
    flexShrink: 1,
    textAlign: 'right',
  },
});

/** Section title above the staked live cards. */
export function YourLiveGames({
  cards,
  onSwitch,
  localRouteFor,
  onSwitchLocal,
}: {
  cards: LiveStakeCardModel[];
  onSwitch: (game: LiveGame) => void;
  localRouteFor?: (game: LiveGame) => GameBroadcast | null;
  onSwitchLocal?: (game: LiveGame, broadcast: GameBroadcast) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <View style={styles.list}>
      <Text style={styles.sectionLabel}>Your live games</Text>
      {cards.map((model) => (
        <LiveStakeGameCard
          key={model.game.game_id}
          localRoute={localRouteFor?.(model.game) ?? null}
          model={model}
          onSwitch={onSwitch}
          onSwitchLocal={
            onSwitchLocal ? (broadcast) => onSwitchLocal(model.game, broadcast) : undefined
          }
        />
      ))}
    </View>
  );
}
