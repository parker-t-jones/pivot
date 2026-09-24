import { StyleSheet, Text, View } from 'react-native';

import { networkLabel } from '../lib/board';
import { fonts } from '../lib/fonts';
import { formatNextGameWhen, type LineupGameGroup } from '../lib/homeState';
import type { ScheduleGame } from '../lib/schedule';
import { theme } from '../lib/theme';
import { Slip } from './Slip';

/** Split team-color band across the top edge (PIVOT-STAKES-PLAN.md §11.2). */
const BAND_HEIGHT = 4;

interface FeaturedStakeCardProps {
  game: ScheduleGame;
  /**
   * Rostered players in this matchup, rendered as outlined chips. Empty for the "NEXT KICKOFF"
   * fallback hero, which shows a game the user has no stake in. After stakes Phase 3 these
   * become stake conditions rather than roster players.
   */
  players?: LineupGameGroup['players'];
  /** `NEXT KICKOFF` when Home is falling back to a game with no stake in it. */
  eyebrow?: string;
}

/**
 * Home's pre-game hero (PIVOT-STAKES-PLAN.md §11.2): the game the user has most riding on,
 * chosen by `pickFeaturedGame`. Sits on `Slip` so the surface recipe stays in one place.
 */
export function FeaturedStakeCard({
  game,
  players = [],
  eyebrow = 'BIGGEST STAKE',
}: FeaturedStakeCardProps) {
  const network = networkLabel(game.broadcasts);
  const when = formatNextGameWhen(game.scheduled_start);

  return (
    <Slip style={styles.card}>
      <View style={styles.band}>
        <View style={[styles.bandHalf, { backgroundColor: game.away_team_primary_color }]} />
        <View style={[styles.bandHalf, { backgroundColor: game.home_team_primary_color }]} />
      </View>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.meta}>{network === null ? when : `${when} · ${network}`}</Text>
        </View>

        <View style={styles.matchupRow}>
          <Text numberOfLines={1} style={styles.nickname}>
            {game.away_team_name.toUpperCase()}
          </Text>
          <Text style={styles.at}>@</Text>
          <Text numberOfLines={1} style={styles.nickname}>
            {game.home_team_name.toUpperCase()}
          </Text>
        </View>

        {players.length > 0 ? (
          <View style={styles.chips}>
            {players.map((player) => (
              <View key={player.player_id} style={styles.chip}>
                <Text style={styles.chipName}>
                  {`${player.first_name} ${player.last_name}`.trim()}
                </Text>
                <Text style={styles.chipPosition}>{player.position}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Slip>
  );
}

const styles = StyleSheet.create({
  at: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
  },
  band: {
    flexDirection: 'row',
    height: BAND_HEIGHT,
    width: '100%',
  },
  bandHalf: {
    flex: 1,
  },
  body: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  card: {
    // Clips the band to the Slip's corner radius.
    overflow: 'hidden',
    width: '100%',
  },
  chip: {
    alignItems: 'center',
    borderColor: theme.colors.border,
    borderRadius: theme.radii.pill,
    borderWidth: theme.effects.panelBorderWidth,
    flexDirection: 'row',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  chipName: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  chipPosition: {
    color: theme.colors.brass,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  matchupRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  meta: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  nickname: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontFamily: theme.type.title.fontFamily,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
    letterSpacing: theme.type.title.letterSpacing,
  },
});
