import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BoardRowData, BoardWindowGroup } from '../lib/board';
import { fonts } from '../lib/fonts';
import type { LineupGameGroup } from '../lib/homeState';
import { useHomeSegment } from '../lib/homeSegment';
import type { LiveBoardSection } from '../lib/liveBoard';
import type { LiveGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { BoardRow } from './BoardRow';
import { HomeSegmentRow } from './HomeSegmentRow';
import { MyCardList } from './MyCardList';

/** `● LIVE · {n} GAMES` above the Home title in `state1` / `state2` (PIVOT-STAKES-PLAN.md §11.3). */
export function LiveModeEyebrow({ liveCount }: { liveCount: number }) {
  return (
    <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.modeEyebrow}>
      {`● LIVE · ${liveCount} ${liveCount === 1 ? 'GAME' : 'GAMES'}`}
    </Text>
  );
}

interface HomeLiveViewProps {
  /** `state1`: NowActiveCard + Also Flagged tiles. `state2`: the live stake game cards. */
  hero: ReactNode;
  sections: LiveBoardSection[];
  /** The full week's board groups, for MY CARD. */
  groups: BoardWindowGroup[];
  lineupGroups: LineupGameGroup[];
  /** Every game in progress, for MY CARD's live headers. */
  liveGames: LiveGame[];
}

/**
 * Live Home (`state1` / `state2`) on the pre-game skeleton: BOARD | MY CARD, then the hero and the
 * live board, or the MY CARD list. One element for both branches, so a flag firing or clearing
 * keeps it mounted; the segment itself is shared with the pre-game view (`useHomeSegment`).
 */
export function HomeLiveView({
  hero,
  sections,
  groups,
  lineupGroups,
  liveGames,
}: HomeLiveViewProps) {
  const [segment, selectSegment] = useHomeSegment();

  return (
    <View style={styles.wrap}>
      <HomeSegmentRow segment={segment} onChange={selectSegment} />
      {segment === 'board' ? (
        <>
          {hero}
          {sections.map((section) => (
            <LiveBoardSectionView key={section.kind} section={section} />
          ))}
        </>
      ) : (
        <MyCardList groups={groups} lineupGroups={lineupGroups} liveGames={liveGames} />
      )}
    </View>
  );
}

const SECTION_LABELS: Record<LiveBoardSection['kind'], string> = {
  live: 'LIVE',
  up_next: 'UP NEXT',
  final: 'FINAL',
};

function LiveBoardSectionView({ section }: { section: LiveBoardSection }) {
  return (
    <View style={styles.section}>
      <Text
        maxFontSizeMultiplier={theme.fontScaleCaps.dense}
        style={[styles.sectionLabel, section.kind === 'live' && styles.sectionLabelLive]}
      >
        {SECTION_LABELS[section.kind]}
      </Text>
      <View style={styles.board}>
        {section.kind === 'up_next' ? (
          section.groups.map((group) => (
            <View key={group.label} style={styles.boardGroup}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.windowLabel}>
                {group.label}
              </Text>
              <Rows rows={group.rows} />
            </View>
          ))
        ) : section.kind === 'live' ? (
          section.rows.map((row, index) => (
            <BoardRow
              key={row.gameId}
              row={row}
              showDivider={index > 0}
              mode="live"
              live={{ clock: row.clock, score: row.score }}
            />
          ))
        ) : (
          <Rows rows={section.rows} />
        )}
      </View>
    </View>
  );
}

function Rows({ rows }: { rows: BoardRowData[] }) {
  return (
    <>
      {rows.map((row, index) => (
        <BoardRow key={row.gameId} row={row} showDivider={index > 0} mode="live" />
      ))}
    </>
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
  },
  boardGroup: {
    width: '100%',
  },
  modeEyebrow: {
    color: theme.colors.flare,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginBottom: theme.spacing.xs,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionLabel: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  sectionLabelLive: {
    color: theme.colors.flare,
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
