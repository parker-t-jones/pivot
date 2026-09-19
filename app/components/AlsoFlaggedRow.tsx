import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  alsoFlaggedSituationLines,
  type CurrentFlag,
} from '../lib/gameDisplay';
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
 * PLAN.md Section 10 Home State 1 "Also flagged" row — every other flagged game rendered below
 * `NowActiveCard`. Situation cards (stacked abbrs + color dots, clock / field position /
 * down-distance); intentionally no `FieldGauge` and no `accentBorder`/`panelGlow` — that treatment
 * stays reserved for the card that owns the user's primary flag (UI-SPEC.md §3.3). NFL team logos
 * are a non-goal (no logo field on `GameSummary`). Renders nothing when there's nothing to show.
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
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
      </ScrollView>
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
    fontSize: theme.type.small.size,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    width: 220,
  },
  dot: {
    borderRadius: theme.radii.pill,
    height: 10,
    width: 10,
  },
  /** Same eyebrow family as NowActiveCard's "Now active" label (UI-SPEC.md §2.4). */
  label: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  scrollContent: {
    gap: theme.spacing.sm,
  },
  situation: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 2,
  },
  situationLine: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    fontVariant: [...theme.type.score.fontVariant],
    textAlign: 'right',
  },
  switchButton: {
    alignItems: 'center',
    borderColor: theme.colors.accent,
    borderRadius: theme.radii.control,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    minWidth: 72,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  switchButtonPressed: {
    backgroundColor: theme.colors.accentMuted,
  },
  switchLabel: {
    color: theme.colors.accent,
    fontSize: theme.type.small.size,
    fontWeight: theme.type.smallStrong.weight,
  },
  teamRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  teams: {
    gap: theme.spacing.sm,
    justifyContent: 'center',
  },
  wrap: {
    gap: theme.spacing.sm,
  },
});
