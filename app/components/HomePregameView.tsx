import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildMyCardGames,
  flattenRows,
  type BoardWindowGroup,
  type MyCardGame,
} from '../lib/board';
import { fonts } from '../lib/fonts';
import { formatCountdown, type LineupGameGroup } from '../lib/homeState';
import type { ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { BoardRow } from './BoardRow';
import { FeaturedStakeCard } from './FeaturedStakeCard';
import { SegmentedControl } from './SegmentedControl';

/** Inside a day, the countdown goes from `brass` to `accent` (PIVOT-STAKES-PLAN.md §11.3). */
const ACCENT_COUNTDOWN_MS = 24 * 60 * 60 * 1000;
/** Same 3pt stake stripe BoardRow uses — kept local so MY CARD doesn't import BoardRow styles. */
const STRIPE_WIDTH = 3;
const TIME_COLUMN_WIDTH = 68;
const NETWORK_COLUMN_WIDTH = 58;

const PREGAME_SEGMENTS = [
  { key: 'board', label: 'BOARD' },
  { key: 'my_card', label: 'MY CARD' },
] as const;

type PregameSegmentKey = (typeof PREGAME_SEGMENTS)[number]['key'];

/**
 * Session-only segment memory (PIVOT-STAKES-PLAN.md §11.3). Survives tab switches and
 * backgrounding because the JS module stays warm; resets to BOARD on a cold start because
 * the module reloads. Deliberately not AsyncStorage / preferences.
 */
let rememberedSegment: PregameSegmentKey = 'board';

export interface PregameHero {
  game: ScheduleGame;
  /** Empty for the NEXT KICKOFF fallback, which is a game with no stake in it. */
  players: LineupGameGroup['players'];
  eyebrow?: string;
}

interface HomePregameViewProps {
  week: number;
  groups: BoardWindowGroup[];
  /** Active-roster groups for MY CARD — same `lineupGroups` Home already holds. */
  lineupGroups: LineupGameGroup[];
  hero: PregameHero | null;
  /** Milliseconds to the next kickoff anywhere in the slate, or null to hide the countdown. */
  countdownMs: number | null;
}

function formatKickoffTime(kickoff: Date): string {
  return kickoff.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeColumnLabel(game: MyCardGame): string {
  if (game.status === 'final') return 'FINAL';
  return formatKickoffTime(game.kickoff);
}

/**
 * The merged pre-game presentation for Home `state3` and `state4` (PIVOT-STAKES-PLAN.md §11.3):
 * a mode header, BOARD | MY CARD, then either the biggest-stake hero + full slate or the
 * fantasy-only MY CARD list. Both branches render this identically — the split between them
 * stays in `resolveHomeBranch` because it still drives whether the live machine is armed.
 */
export function HomePregameView({
  week,
  groups,
  lineupGroups,
  hero,
  countdownMs,
}: HomePregameViewProps) {
  const router = useRouter();
  const [segment, setSegment] = useState<PregameSegmentKey>(rememberedSegment);

  const myCardGames = useMemo(
    () => buildMyCardGames(flattenRows(groups), lineupGroups),
    [groups, lineupGroups],
  );

  function selectSegment(key: string) {
    if (key !== 'board' && key !== 'my_card') return;
    rememberedSegment = key;
    setSegment(key);
  }

  function openLineup() {
    router.push('/(app)/(tabs)/lineup');
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.modeEyebrow}>{`WEEK ${week} · PRE-GAME`}</Text>
        {countdownMs === null ? null : (
          <View style={styles.headerMeta}>
            <Text style={styles.metaLabel}>NEXT KICKOFF</Text>
            <Text
              style={[
                styles.countdown,
                countdownMs < ACCENT_COUNTDOWN_MS && styles.countdownSoon,
              ]}
            >
              {formatCountdown(countdownMs)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.segmentRow}>
        <View style={styles.segmentControl}>
          <SegmentedControl
            segments={[...PREGAME_SEGMENTS]}
            value={segment}
            onChange={selectSegment}
          />
        </View>
        {segment === 'my_card' ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Manage lineup"
            onPress={openLineup}
            hitSlop={8}
          >
            <Text style={styles.manageLink}>Manage</Text>
          </Pressable>
        ) : null}
      </View>

      {segment === 'board' ? (
        <>
          {hero === null ? null : (
            <FeaturedStakeCard
              game={hero.game}
              players={hero.players}
              {...(hero.eyebrow === undefined ? {} : { eyebrow: hero.eyebrow })}
            />
          )}

          {groups.length > 0 ? (
            <View style={styles.board}>
              {groups.map((group) => (
                <View key={group.label} style={styles.boardGroup}>
                  <Text style={styles.windowLabel}>{group.label}</Text>
                  {group.rows.map((row, index) => (
                    <BoardRow key={row.gameId} row={row} showDivider={index > 0} />
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : myCardGames.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyCopy}>No starters this week.</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Manage lineup"
            onPress={openLineup}
            hitSlop={8}
          >
            <Text style={styles.manageLink}>Manage</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.myCardList}>
          {myCardGames.map((game) => (
            <MyCardGameBlock key={game.gameId} game={game} />
          ))}
        </View>
      )}
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
  board: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.lg,
    borderWidth: theme.effects.panelBorderWidth,
    // Keeps the row tint and team stripes inside the rounded corners.
    overflow: 'hidden',
    paddingBottom: theme.spacing.sm,
  },
  boardGroup: {
    width: '100%',
  },
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
  countdown: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    textAlign: 'right',
  },
  countdownSoon: {
    color: theme.colors.accent,
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
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerMeta: {
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
  },
  manageLink: {
    color: theme.colors.accent,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  metaLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  modeEyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  myCardList: {
    gap: theme.spacing.md,
    width: '100%',
  },
  segmentControl: {
    flex: 1,
  },
  segmentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.md,
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
  windowLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    paddingBottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  wrap: {
    gap: theme.spacing.lg,
    width: '100%',
  },
});
