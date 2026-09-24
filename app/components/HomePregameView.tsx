import { StyleSheet, Text, View } from 'react-native';

import type { BoardWindowGroup } from '../lib/board';
import { fonts } from '../lib/fonts';
import { formatCountdown, type LineupGameGroup } from '../lib/homeState';
import type { ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { BoardRow } from './BoardRow';
import { FeaturedStakeCard } from './FeaturedStakeCard';

/** Inside a day, the countdown goes from `brass` to `accent` (PIVOT-STAKES-PLAN.md §11.3). */
const ACCENT_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

export interface PregameHero {
  game: ScheduleGame;
  /** Empty for the NEXT KICKOFF fallback, which is a game with no stake in it. */
  players: LineupGameGroup['players'];
  eyebrow?: string;
}

interface HomePregameViewProps {
  week: number;
  groups: BoardWindowGroup[];
  hero: PregameHero | null;
  /** Milliseconds to the next kickoff anywhere in the slate, or null to hide the countdown. */
  countdownMs: number | null;
}

/**
 * The merged pre-game presentation for Home `state3` and `state4` (PIVOT-STAKES-PLAN.md §11.3):
 * a mode header, the biggest-stake hero, and the full week's slate grouped by broadcast window.
 * Both branches render this identically — the split between them stays in `resolveHomeBranch`
 * because it still drives whether the live machine is armed.
 *
 * The board deliberately lists games the user has no stake in, muted. That's what makes it a
 * board rather than a watchlist.
 */
export function HomePregameView({ week, groups, hero, countdownMs }: HomePregameViewProps) {
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
    justifyContent: 'space-between',
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
  wrap: {
    gap: theme.spacing.lg,
    width: '100%',
  },
});
