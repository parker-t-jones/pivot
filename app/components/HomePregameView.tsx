import { StyleSheet, Text, View } from 'react-native';

import type { BoardWindowGroup, StakeRef } from '../lib/board';
import { fonts } from '../lib/fonts';
import { DESKTOP_RIGHT_COLUMN } from '../lib/desktopLayout';
import type { LineupGameGroup } from '../lib/homeState';
import { kickoffLabel } from '../lib/kickoffLabel';
import { useHomeSegment } from '../lib/homeSegment';
import { useDesktopTier } from '../lib/useDesktopTier';
import type { ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { BoardRow } from './BoardRow';
import { FeaturedStakeCard, type FeaturedBetChip } from './FeaturedStakeCard';
import { HomeSegmentRow } from './HomeSegmentRow';
import { MyCardList } from './MyCardList';

/** Inside a day, the countdown goes from `brass` to `accent` (PIVOT-STAKES-PLAN.md §11.3). */
const ACCENT_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

export interface PregameHero {
  game: ScheduleGame;
  /** Empty for the NEXT KICKOFF fallback, which is a game with no stake in it. */
  players: LineupGameGroup['players'];
  /** Bet chips for the featured game. Absent on the NEXT KICKOFF fallback. */
  bets?: FeaturedBetChip[];
  eyebrow?: string;
  /** Up next shows `kickoffLabel`. Biggest stake keeps the card's own clock. */
  when?: string;
}

interface HomePregameViewProps {
  week: number;
  groups: BoardWindowGroup[];
  /** Active-roster groups for MY CARD — same `lineupGroups` Home already holds. */
  lineupGroups: LineupGameGroup[];
  /** Bet refs for MY CARD lines. Markers already come from the board groups. */
  betRefs?: readonly StakeRef[];
  hero: PregameHero | null;
  /** Milliseconds to the next kickoff anywhere in the slate, or null to hide the countdown. */
  countdownMs: number | null;
  /** Instant behind `countdownMs`. The weekday label needs the clock, not just the distance. */
  nextKickoffAt: Date | null;
  nowMs: number;
  editsLocked?: boolean;
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
  betRefs = [],
  hero,
  countdownMs,
  nextKickoffAt,
  nowMs,
  editsLocked = false,
}: HomePregameViewProps) {
  const kickoff =
    countdownMs === null || nextKickoffAt === null
      ? null
      : kickoffLabel(nextKickoffAt, new Date(nowMs));
  const tier = useDesktopTier();
  const [segment, selectSegment] = useHomeSegment();

  const board = (
    <>
      {hero === null ? null : (
        <FeaturedStakeCard
          game={hero.game}
          players={hero.players}
          bets={hero.bets ?? []}
          {...(hero.eyebrow === undefined ? {} : { eyebrow: hero.eyebrow })}
          {...(hero.when === undefined ? {} : { when: hero.when })}
        />
      )}
      {groups.length > 0 ? (
        <View style={styles.board}>
          {groups.map((group) => (
            <View key={group.label} style={styles.boardGroup}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.windowLabel}>
                {group.label}
              </Text>
              {group.rows.map((row, index) => (
                <BoardRow key={row.gameId} row={row} showDivider={index > 0} />
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  if (tier === 'wide') {
    return (
      <View style={styles.wide}>
        <View style={styles.wideRow}>
          <View style={styles.wideMain}>
            <View style={styles.wideKickoff}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.modeEyebrow}>
                {`WEEK ${week} · PRE-GAME`}
              </Text>
              {kickoff === null ? null : (
                <Text
                  maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                  numberOfLines={1}
                  style={[
                    styles.metaLabel,
                    countdownMs !== null &&
                      countdownMs < ACCENT_COUNTDOWN_MS &&
                      styles.countdownSoon,
                  ]}
                >
                  {`NEXT KICKOFF · ${kickoff}`}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.wideSide}>
            <MyCardList
              betRefs={betRefs}
              groups={groups}
              editsLocked={editsLocked}
              lineupGroups={lineupGroups}
              part="header"
            />
          </View>
        </View>
        <View style={[styles.wideRow, styles.wideBodyRow]}>
          <View style={[styles.wideMain, styles.wideBody]}>{board}</View>
          <View style={[styles.wideSide, styles.wideBodyColumn]}>
            <MyCardList
              betRefs={betRefs}
              groups={groups}
              editsLocked={editsLocked}
              lineupGroups={lineupGroups}
              part="cards"
            />
          </View>
        </View>
      </View>
    );
  }

  if (tier !== 'companion') {
    return (
      <View style={styles.split}>
        <View style={styles.center}>
          <View style={styles.header}>
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.modeEyebrow}>
              {`WEEK ${week} · PRE-GAME`}
            </Text>
            {kickoff === null ? null : (
              <View style={styles.headerMeta}>
                <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.metaLabel}>
                  NEXT KICKOFF
                </Text>
                <Text
                  maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                  style={[
                    styles.countdown,
                    countdownMs !== null &&
                      countdownMs < ACCENT_COUNTDOWN_MS &&
                      styles.countdownSoon,
                  ]}
                >
                  {kickoff}
                </Text>
              </View>
            )}
          </View>
          {board}
        </View>
        <View style={styles.side}>
          <MyCardList
            betRefs={betRefs}
            groups={groups}
            editsLocked={editsLocked}
            lineupGroups={lineupGroups}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.modeEyebrow}>
          {`WEEK ${week} · PRE-GAME`}
        </Text>
        {kickoff === null ? null : (
          <View style={styles.headerMeta}>
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.metaLabel}>
              NEXT KICKOFF
            </Text>
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              style={[
                styles.countdown,
                countdownMs !== null && countdownMs < ACCENT_COUNTDOWN_MS && styles.countdownSoon,
              ]}
            >
              {kickoff}
            </Text>
          </View>
        )}
      </View>

      <HomeSegmentRow segment={segment} onChange={selectSegment} />

      {segment === 'board' ? (
        board
      ) : (
        <MyCardList
          betRefs={betRefs}
          groups={groups}
          editsLocked={editsLocked}
          lineupGroups={lineupGroups}
        />
      )}
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
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.xs,
  },
  headerMeta: {
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
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
  windowLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    paddingBottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  center: {
    flex: 1,
    gap: theme.spacing.lg,
    minWidth: 0,
  },
  side: {
    flexShrink: 0,
    width: DESKTOP_RIGHT_COLUMN,
  },
  split: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: theme.spacing.lg,
    width: '100%',
  },
  wide: {
    gap: theme.spacing.lg,
    width: '100%',
  },
  wideBody: {
    gap: theme.spacing.lg,
    justifyContent: 'flex-start',
  },
  wideBodyColumn: {
    justifyContent: 'flex-start',
  },
  /** Cards start with the hero. The header row above keeps vertical centering. */
  wideBodyRow: {
    alignItems: 'flex-start',
  },
  wideKickoff: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  wideMain: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  wideRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: theme.spacing.lg,
  },
  wideSide: {
    flexShrink: 0,
    justifyContent: 'center',
    width: DESKTOP_RIGHT_COLUMN,
  },
  wrap: {
    gap: theme.spacing.lg,
    width: '100%',
  },
});
