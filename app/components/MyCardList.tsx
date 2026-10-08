import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  buildMyCardGames,
  flattenRows,
  type BoardWindowGroup,
  type MyCardGame,
} from '../lib/board';
import { fonts } from '../lib/fonts';
import { compactScoreLabel, liveClockLabel } from '../lib/gameDisplay';
import type { LineupGameGroup } from '../lib/homeState';
import type { LiveGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { ManageLineupLink } from './HomeSegmentRow';

/** Same 3pt stake stripe BoardRow uses — kept local so MY CARD doesn't import BoardRow styles. */
const STRIPE_WIDTH = 3;
/** Holds "12:00 PM" at the default ticker size; the column grows with the text. */
const TIME_COLUMN_MIN_WIDTH = 68;
const NETWORK_COLUMN_WIDTH = 58;

interface MyCardListProps {
  /** The week's board groups; MY CARD keeps their order, network and stripe. */
  groups: BoardWindowGroup[];
  /** Active-roster groups — same `lineupGroups` Home already holds. */
  lineupGroups: LineupGameGroup[];
  /** Games in progress, for the clock and score on live headers. */
  liveGames?: LiveGame[];
}

function formatKickoffTime(kickoff: Date): string {
  return kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The MY CARD segment (PIVOT-STAKES-PLAN.md §11.3): one `well` block per stake game. */
export function MyCardList({ groups, lineupGroups, liveGames = [] }: MyCardListProps) {
  const myCardGames = useMemo(
    () => buildMyCardGames(flattenRows(groups), lineupGroups),
    [groups, lineupGroups],
  );
  const liveById = useMemo(
    () => new Map(liveGames.map((game) => [game.game_id, game])),
    [liveGames],
  );
  const stakeCount = myCardGames.reduce((sum, game) => sum + game.stakes.length, 0);

  return (
    <View style={styles.myCardList}>
      <View style={styles.stakesHeader}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.stakesEyebrow}>
          {`YOUR STAKES · ${stakeCount}`}
        </Text>
        <ManageLineupLink />
      </View>
      {myCardGames.length === 0 ? (
        <Text style={styles.emptyCopy}>No starters this week.</Text>
      ) : (
        myCardGames.map((game) => (
          <MyCardGameBlock key={game.gameId} game={game} live={liveById.get(game.gameId) ?? null} />
        ))
      )}
    </View>
  );
}

function MyCardGameBlock({ game, live }: { game: MyCardGame; live: LiveGame | null }) {
  const hasStripe = game.stripeSide !== null;
  const stripeColor =
    game.stripeSide === 'home'
      ? game.homeTeamColor
      : game.stripeSide === 'away'
        ? game.awayTeamColor
        : '';
  const inProgress = game.status === 'in_progress' || (live !== null && game.status !== 'final');
  const isFinal = game.status === 'final';
  const time = isFinal
    ? 'FINAL'
    : inProgress
      ? live
        ? liveClockLabel(live.quarter, live.time_remaining_sec)
        : 'LIVE'
      : formatKickoffTime(game.kickoff);
  const score = inProgress && live ? compactScoreLabel(live.score) : null;
  const matchup = `${game.awayTeamId} @ ${game.homeTeamId}`;

  return (
    <View style={styles.cardBlock}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.stripe,
            hasStripe
              ? { backgroundColor: stripeColor.length > 0 ? stripeColor : theme.colors.accent }
              : null,
          ]}
        />
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={[
            styles.cardTime,
            inProgress ? styles.cardTimeLive : null,
            isFinal ? styles.cardTimeFinal : null,
          ]}
        >
          {time}
        </Text>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.cardMatchup}
        >
          {matchup}
        </Text>
        <Text
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={styles.cardNetwork}
        >
          {game.network ?? ''}
        </Text>
        {score !== null ? (
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.cardScore}
          >
            {score}
          </Text>
        ) : null}
      </View>
      {game.stakes.map((stake, index) => (
        <View
          key={`${stake.label}-${stake.value}-${index}`}
          style={[styles.stakeLine, index === 0 ? styles.stakeLineFirst : null]}
        >
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.stakeTag}
          >
            {stake.tag}
          </Text>
          <Text numberOfLines={1} style={styles.stakeLabel}>
            {stake.label}
          </Text>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.stakeValue}
          >
            {stake.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cardBlock: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
    paddingBottom: theme.spacing.sm,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 40,
    paddingTop: theme.spacing.sm,
  },
  cardMatchup: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  cardNetwork: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    marginLeft: theme.spacing.md,
    marginRight: theme.spacing.md,
    width: NETWORK_COLUMN_WIDTH,
  },
  cardScore: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    marginLeft: 'auto',
    marginRight: theme.spacing.md,
  },
  cardTime: {
    color: theme.colors.brass,
    fontFamily: fonts.monoMedium,
    flexShrink: 0,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    minWidth: TIME_COLUMN_MIN_WIDTH,
    paddingRight: theme.spacing.sm,
  },
  cardTimeFinal: {
    color: theme.colors.textTertiary,
  },
  cardTimeLive: {
    color: theme.colors.flare,
  },
  emptyCopy: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  myCardList: {
    gap: theme.spacing.md,
    width: '100%',
  },
  stakeLabel: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
  },
  stakesEyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  stakesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.xs,
  },
  stakeLine: {
    alignItems: 'center',
    borderTopColor: theme.colors.rowDivider,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  stakeLineFirst: {
    borderTopWidth: 0,
  },
  stakeTag: {
    color: theme.colors.brass,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  stakeValue: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    marginLeft: 'auto',
  },
  stripe: {
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    marginRight: theme.spacing.md,
    width: STRIPE_WIDTH,
  },
});
