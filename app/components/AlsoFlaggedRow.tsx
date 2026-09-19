import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  alsoFlaggedSituationLines,
  type CurrentFlag,
} from '../lib/gameDisplay';
import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

interface AlsoFlaggedRowProps {
  /** Every flagged game below the Home State 1 primary, already priority-sorted. */
  flags: CurrentFlag[];
  /**
   * Resolves that game's broadcast and switches playback to it directly. Does not touch which
   * card is primary on Home — see report ("also-flagged-switch" scope note).
   */
  onSwitch: (flag: CurrentFlag) => Promise<void>;
}

function teamDotColor(hex: string): string {
  return hex.length > 0 ? hex : theme.colors.border;
}

/**
 * PLAN.md Section 10 Home State 1 "Also flagged" — every other flagged game below
 * `NowActiveCard`. Two cards per row (wrap below); situation cards (stacked abbrs + color dots,
 * clock / field position / down-distance); intentionally no `FieldGauge` and no
 * `accentBorder`/`panelGlow` — that treatment stays reserved for the primary flag card
 * (UI-SPEC.md §3.3). NFL team logos are a non-goal (no logo field on `GameSummary`).
 * Renders nothing when there's nothing to show.
 */
export function AlsoFlaggedRow({ flags, onSwitch }: AlsoFlaggedRowProps) {
  const [switchingGameId, setSwitchingGameId] = useState<string | null>(null);

  if (flags.length === 0) return null;

  const onPressSwitch = (flag: CurrentFlag) => {
    setSwitchingGameId(flag.game_id);
    void onSwitch(flag).finally(() => setSwitchingGameId(null));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Also flagged</Text>
      <View style={styles.grid}>
        {flags.map((flag) => {
          const isSwitching = switchingGameId === flag.game_id;
          const situation = alsoFlaggedSituationLines(flag.game);
          return (
            <View key={flag.game_id} style={styles.card}>
              <View style={styles.teams}>
                <TeamRow
                  color={teamDotColor(flag.game.away_team_primary_color)}
                  abbreviation={flag.game.away_team}
                />
                <TeamRow
                  color={teamDotColor(flag.game.home_team_primary_color)}
                  abbreviation={flag.game.home_team}
                />
              </View>
              <View style={styles.cardDivider} />
              <View style={styles.situation}>
                {situation.map((line) => (
                  <Text key={line} style={styles.situationLine}>
                    {line}
                  </Text>
                ))}
                <Pressable
                  accessibilityLabel={`Switch to ${flag.game.away_team} at ${flag.game.home_team}`}
                  accessibilityRole="button"
                  disabled={isSwitching}
                  onPress={() => onPressSwitch(flag)}
                  style={({ pressed }) => [
                    styles.switchButton,
                    pressed && !isSwitching && styles.switchButtonPressed,
                  ]}
                >
                  {isSwitching ? (
                    <ActivityIndicator color={theme.colors.accent} size="small" />
                  ) : (
                    <Text style={styles.switchLabel}>Switch</Text>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TeamRow({ color, abbreviation }: { color: string; abbreviation: string }) {
  return (
    <View style={styles.teamRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.abbreviation}>{abbreviation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  abbreviation: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  card: {
    // Same canvas black as NowActiveCard (not `surface`).
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    maxWidth: '48.5%',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  cardDivider: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing.xs,
    width: StyleSheet.hairlineWidth * 2,
  },
  dot: {
    borderRadius: theme.radii.pill,
    height: 9,
    width: 9,
  },
  grid: {
    columnGap: theme.spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: theme.spacing.sm,
  },
  /** Same eyebrow family as NowActiveCard's "Now active" label (UI-SPEC.md §2.4). */
  label: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  situation: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  situationLine: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.ticker.fontFamily,
    fontSize: 11,
    fontVariant: [...theme.type.score.fontVariant],
    lineHeight: 14,
    textAlign: 'right',
  },
  switchButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    borderColor: theme.colors.accent,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  switchButtonPressed: {
    backgroundColor: theme.colors.accentMuted,
  },
  switchLabel: {
    color: theme.colors.accent,
    fontSize: theme.type.caption.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  teamRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  /** 4/9 − 1/20 of the card width (divider nudged left by 5%). */
  teams: {
    justifyContent: 'space-evenly',
    minHeight: 72,
    width: '39.444%',
  },
  wrap: {
    gap: theme.spacing.sm,
  },
});
