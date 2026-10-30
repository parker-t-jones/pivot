import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  buildMyCardGames,
  flattenRows,
  type BoardWindowGroup,
  type MyCardGame,
  type StakeRef,
} from '../lib/board';
import { GameAnchor } from '../lib/gameAnchor';
import { fonts } from '../lib/fonts';
import { compactScoreLabel, liveClockLabel } from '../lib/gameDisplay';
import type { LineupGameGroup } from '../lib/homeState';
import type { LiveGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { useOpenAddPick } from '../lib/useOpenAddPick';
import { ManageLineupLink } from './HomeSegmentRow';
import { TextButton } from './TextButton';
import { StreamLinkControl } from './StreamLinkControl';

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
  /** Bet refs already merged onto the board. Fantasy lines still come from `lineupGroups`. */
  betRefs?: readonly StakeRef[];
  /**
   * Wide Home puts the header and the cards in separate grid rows so they line up
   * with the board column. Other layouts keep both together.
   */
  part?: 'all' | 'header' | 'cards';
}

function formatKickoffTime(kickoff: Date): string {
  return kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The MY CARD segment (PIVOT-STAKES-PLAN.md §11.3): one `well` block per stake game. */
export function MyCardList({
  groups,
  lineupGroups,
  liveGames = [],
  betRefs = [],
  part = 'all',
}: MyCardListProps) {
  const myCardGames = useMemo(
    () => buildMyCardGames(flattenRows(groups), lineupGroups, betRefs),
    [groups, lineupGroups, betRefs],
  );
  const liveById = useMemo(
    () => new Map(liveGames.map((game) => [game.game_id, game])),
    [liveGames],
  );
  const stakeCount = myCardGames.reduce((sum, game) => sum + game.stakes.length, 0);
  const openAddPick = useOpenAddPick();

  const header = (
    <View style={styles.stakesHeader}>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.stakesEyebrow}>
        {`YOUR PICKS · ${stakeCount}`}
      </Text>
      <View style={styles.headerActions}>
        <TextButton label="Add a pick" onPress={openAddPick} size="smallStrong" />
        <ManageLineupLink />
      </View>
    </View>
  );
  const cards =
    myCardGames.length === 0 ? (
      <Text style={styles.emptyCopy}>No starters this week.</Text>
    ) : (
      myCardGames.map((game) => (
        <MyCardGameBlock key={game.gameId} game={game} live={liveById.get(game.gameId) ?? null} />
      ))
    );

  if (part === 'header') return header;
  if (part === 'cards') return <View style={styles.myCardList}>{cards}</View>;

  return (
    <View style={styles.myCardList}>
      {header}
      {cards}
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
        ? liveClockLabel(live.quarter, live.time_remaining_sec, live.possession_team)
        : 'LIVE'
      : formatKickoffTime(game.kickoff);
  const score = inProgress && live ? compactScoreLabel(live.score) : null;
  const matchup = `${game.awayTeamId} @ ${game.homeTeamId}`;

  return (
    <GameAnchor gameId={game.gameId} style={[styles.cardBlock, isFinal && styles.cardBlockFinal]}>
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
          style={[
            styles.cardTime,
            inProgress ? styles.cardTimeLive : null,
            isFinal ? styles.cardTimeFinal : null,
          ]}
        >
          {time}
        </Text>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.cardMatchup}>
          {matchup}
        </Text>
        {score !== null ? (
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.cardScore}>
            {score}
          </Text>
        ) : null}
      </View>
      <View style={styles.linkRow}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.cardNetwork}>
          {game.network ?? ''}
        </Text>
        <StreamLinkControl away={game.awayTeamId} gameId={game.gameId} home={game.homeTeamId} />
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
          <Text style={styles.stakeLabel}>{stake.label}</Text>
          {stake.value.length > 0 ? (
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.stakeValue}>
              {stake.value}
            </Text>
          ) : null}
        </View>
      ))}
    </GameAnchor>
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
  cardBlockFinal: {
    opacity: theme.opacity.disabled,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    minHeight: 40,
    paddingTop: theme.spacing.sm,
  },
  cardMatchup: {
    color: theme.colors.textPrimary,
    flexGrow: 1,
    flexShrink: 0,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  cardNetwork: {
    color: theme.colors.textTertiary,
    flexShrink: 0,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    marginRight: theme.spacing.md,
    width: NETWORK_COLUMN_WIDTH,
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 0,
    paddingLeft: STRIPE_WIDTH + theme.spacing.md,
    paddingRight: theme.spacing.md,
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
    flexGrow: 1,
    flexShrink: 1,
    fontSize: theme.type.body.size,
    lineHeight: theme.type.body.lineHeight,
    minWidth: 0,
  },
  stakesEyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
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
    flexWrap: 'wrap',
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
