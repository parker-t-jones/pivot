import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  buildMyCardGames,
  flattenRows,
  type BoardWindowGroup,
  type MyCardGame,
} from '../lib/board';
import { fonts } from '../lib/fonts';
import type { LineupGameGroup } from '../lib/homeState';
import { theme } from '../lib/theme';
import { ManageLineupLink } from './HomeSegmentRow';

/** Same 3pt stake stripe BoardRow uses — kept local so MY CARD doesn't import BoardRow styles. */
const STRIPE_WIDTH = 3;
const TIME_COLUMN_WIDTH = 68;
const NETWORK_COLUMN_WIDTH = 58;

interface MyCardListProps {
  /** The week's board groups; MY CARD keeps their order, network and stripe. */
  groups: BoardWindowGroup[];
  /** Active-roster groups — same `lineupGroups` Home already holds. */
  lineupGroups: LineupGameGroup[];
}

function formatKickoffTime(kickoff: Date): string {
  return kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeColumnLabel(game: MyCardGame): string {
  if (game.status === 'final') return 'FINAL';
  return formatKickoffTime(game.kickoff);
}

/** The MY CARD segment (PIVOT-STAKES-PLAN.md §11.3): one `well` block per stake game. */
export function MyCardList({ groups, lineupGroups }: MyCardListProps) {
  const myCardGames = useMemo(
    () => buildMyCardGames(flattenRows(groups), lineupGroups),
    [groups, lineupGroups],
  );

  if (myCardGames.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyCopy}>No starters this week.</Text>
        <ManageLineupLink />
      </View>
    );
  }

  return (
    <View style={styles.myCardList}>
      {myCardGames.map((game) => (
        <MyCardGameBlock key={game.gameId} game={game} />
      ))}
    </View>
  );
}

function MyCardGameBlock({ game }: { game: MyCardGame }) {
  const hasStripe = game.stripeSide !== null;
  const stripeColor =
    game.stripeSide === 'home'
      ? game.homeTeamColor
      : game.stripeSide === 'away'
        ? game.awayTeamColor
        : '';
  const time = timeColumnLabel(game);
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
        <Text style={styles.cardTime}>{time}</Text>
        <Text numberOfLines={1} style={styles.cardMatchup}>
          {matchup}
        </Text>
        <Text numberOfLines={1} style={styles.cardNetwork}>
          {game.network ?? ''}
        </Text>
      </View>
      {game.stakes.map((stake, index) => (
        <View
          key={`${stake.label}-${stake.value}-${index}`}
          style={[styles.stakeLine, index === 0 ? styles.stakeLineFirst : null]}
        >
          <Text style={styles.stakeTag}>{stake.tag}</Text>
          <Text numberOfLines={1} style={styles.stakeLabel}>
            {stake.label}
          </Text>
          <Text style={styles.stakeValue}>{stake.value}</Text>
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
  cardTime: {
    color: theme.colors.brass,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    width: TIME_COLUMN_WIDTH,
  },
  emptyCard: {
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
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
