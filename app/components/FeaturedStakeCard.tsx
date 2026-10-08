import { StyleSheet, Text, View } from 'react-native';

import { networkLabelFromAirings } from '@pivot/shared/broadcast';
import { fonts } from '../lib/fonts';
import { watchCta } from '../lib/gameDisplay';
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
  const network = networkLabelFromAirings(game.airings);
  const cta = watchCta(game.broadcasts, game.airings);
  const when = formatNextGameWhen(game.scheduled_start);

  return (
    <Slip style={styles.card}>
      <View style={styles.band}>
        <View style={[styles.bandHalf, { backgroundColor: game.away_team_primary_color }]} />
        <View style={[styles.bandHalf, { backgroundColor: game.home_team_primary_color }]} />
      </View>

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
            {eyebrow}
          </Text>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.meta}>
            {network === null ? when : `${when} · ${network}`}
          </Text>
        </View>

        <Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={theme.fontScaleCaps.title}
          minimumFontScale={0.7}
          numberOfLines={1}
          style={styles.nickname}
        >
          {game.away_team_name.toUpperCase()}
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.at}>
            {' @ '}
          </Text>
          {game.home_team_name.toUpperCase()}
        </Text>

        {players.length > 0 ? (
          <View style={styles.chips}>
            {players.map((player) => (
              <View key={player.player_id} style={styles.chip}>
                <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.chipName}>
                  {`${player.first_name} ${player.last_name}`.trim()}
                </Text>
                <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.chipPosition}>
                  {player.position}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {cta.kind === 'airing' ? <Text style={styles.airing}>{cta.text}</Text> : null}
      </View>
    </Slip>
  );
}

const styles = StyleSheet.create({
  airing: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
  },
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
    flexShrink: 0,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.xs,
  },
  meta: {
    color: theme.colors.textTertiary,
    flexShrink: 0,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
  },
  nickname: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.title.fontFamily,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
    letterSpacing: theme.type.title.letterSpacing,
    width: '100%',
  },
});
