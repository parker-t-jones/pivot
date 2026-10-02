import { StyleSheet, Text, View } from 'react-native';

import type { BoardRowData } from '../lib/board';
import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

/** Row height from PIVOT-STAKES-PLAN.md §11.2 ("a 38–40pt row"). */
const ROW_HEIGHT = 40;
/** Team-color stripe on the left edge of a row the user has a stake in (§11.2). */
const STRIPE_WIDTH = 3;
/** Fixed so kickoff times and FINAL align down the column regardless of string width. */
const TIME_COLUMN_WIDTH = 68;
const NETWORK_COLUMN_WIDTH = 58;
/** Past this many stakes the dots become "+n" rather than growing the row. */
const MAX_STAKE_DOTS = 3;
const STAKE_DOT_SIZE = 6;

interface BoardRowProps {
  row: BoardRowData;
  /** Hairline above the row. The caller passes `false` for the first row in a window group. */
  showDivider?: boolean;
  /** `live` is the board under the live hero: in-progress rows show the clock, finals are muted. */
  mode?: 'pregame' | 'live';
  /** In-progress game clock and compact score, live mode only. Score null → none shown. */
  live?: { clock: string; score: string | null };
}

function formatKickoffTime(kickoff: Date): string {
  // Device-local, same as `formatNextGameWhen`. Only the window *grouping* is pinned to ET.
  return kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeColumnLabel(
  row: BoardRowData,
  mode: 'pregame' | 'live',
  clock: string | undefined,
): string {
  switch (row.status) {
    case 'final':
      // Deliberately no score: the board would spoil a game the user recorded to watch later.
      return 'FINAL';
    case 'in_progress':
      // The pre-game board still reads a live row like a scheduled one.
      return mode === 'live' ? (clock ?? 'LIVE') : formatKickoffTime(row.kickoff);
    default:
      return formatKickoffTime(row.kickoff);
  }
}

function stakeCountPhrase(stakeCount: number): string {
  if (stakeCount === 0) return 'no stakes';
  return stakeCount === 1 ? '1 stake' : `${stakeCount} stakes`;
}

/**
 * One game on Home's pre-game board (PIVOT-STAKES-PLAN.md §11.2). Every game in the week gets a
 * row, whether or not the user has a stake in it — that's what makes it a board rather than a
 * watchlist. Rows with a stake get the team stripe, the `ember` tint and a dot per stake; rows
 * without one stay muted and untinted.
 */
export function BoardRow({ row, showDivider = true, mode = 'pregame', live }: BoardRowProps) {
  const hasStake = row.stakeCount > 0;
  const stripeColor = row.stripeSide === 'home' ? row.homeTeamColor : row.awayTeamColor;
  const liveRow = mode === 'live' && row.status === 'in_progress';
  const mutedFinal = mode === 'live' && row.status === 'final';
  const time = timeColumnLabel(row, mode, live?.clock);
  const score = liveRow ? (live?.score ?? null) : null;
  const matchup = `${row.awayTeamId} @ ${row.homeTeamId}`;

  const dotCount = Math.min(row.stakeCount, MAX_STAKE_DOTS);
  const overflowCount = row.stakeCount - dotCount;

  const accessibilityLabel = [
    time,
    `${row.awayTeamId} at ${row.homeTeamId}`,
    score,
    row.network,
    stakeCountPhrase(row.stakeCount),
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible
      style={[styles.row, hasStake && styles.rowWithStake, showDivider && styles.rowDivider]}
    >
      <View
        style={[
          styles.stripe,
          hasStake && row.stripeSide !== null
            ? { backgroundColor: stripeColor.length > 0 ? stripeColor : theme.colors.accent }
            : null,
        ]}
      />
      <Text
        style={[
          styles.time,
          hasStake ? styles.timeWithStake : null,
          liveRow ? styles.timeLive : null,
          mutedFinal ? styles.timeFinal : null,
        ]}
      >
        {time}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.matchup, hasStake && !mutedFinal ? null : styles.mutedText]}
      >
        {matchup}
      </Text>
      <Text numberOfLines={1} style={styles.network}>
        {row.network ?? ''}
      </Text>
      {score !== null ? (
        <Text numberOfLines={1} style={[styles.score, hasStake ? null : styles.mutedText]}>
          {score}
        </Text>
      ) : null}
      <View style={[styles.dots, score !== null ? styles.dotsAfterScore : null]}>
        {Array.from({ length: dotCount }, (_, index) => (
          <View key={index} style={styles.dot} />
        ))}
        {overflowCount > 0 ? <Text style={styles.dotOverflow}>{`+${overflowCount}`}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.pill,
    height: STAKE_DOT_SIZE,
    width: STAKE_DOT_SIZE,
  },
  dotOverflow: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    paddingRight: theme.spacing.md,
  },
  dotsAfterScore: {
    marginLeft: theme.spacing.sm,
  },
  matchup: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    letterSpacing: theme.type.ticker.letterSpacing,
  },
  mutedText: {
    color: theme.colors.textSecondary,
  },
  network: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    marginLeft: theme.spacing.md,
    width: NETWORK_COLUMN_WIDTH,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    height: ROW_HEIGHT,
  },
  rowDivider: {
    borderTopColor: theme.colors.rowDivider,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowWithStake: {
    backgroundColor: theme.colors.ember,
  },
  score: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    marginLeft: 'auto',
  },
  stripe: {
    alignSelf: 'stretch',
    // Transparent rather than absent so the columns line up between stake and non-stake rows.
    backgroundColor: 'transparent',
    marginRight: theme.spacing.md,
    width: STRIPE_WIDTH,
  },
  time: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    width: TIME_COLUMN_WIDTH,
  },
  timeFinal: {
    color: theme.colors.textTertiary,
  },
  timeLive: {
    color: theme.colors.flare,
  },
  timeWithStake: {
    color: theme.colors.brass,
  },
});
