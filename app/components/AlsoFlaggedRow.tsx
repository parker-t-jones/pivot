import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CurrentFlag } from '../lib/gameDisplay';
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

/**
 * PLAN.md Section 10 Home State 1 "Also flagged" row — every other flagged game rendered below
 * `NowActiveCard`. Compact cards (matchup + score only, no `FieldGauge`); intentionally no
 * `accentBorder`/`panelGlow` here — that treatment stays reserved for the card that owns the
 * user's primary flag (UI-SPEC.md §3.3). Renders nothing when there's nothing to show.
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
          return (
            <View key={flag.game_id} style={styles.card}>
              <Text numberOfLines={1} style={styles.matchup}>
                {flag.game.away_team} @ {flag.game.home_team}
              </Text>
              <Text style={styles.score}>
                {flag.game.score.away}–{flag.game.score.home}
              </Text>
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
                  <ActivityIndicator color={theme.colors.textPrimary} size="small" />
                ) : (
                  <Text style={styles.switchLabel}>Switch</Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    width: 168,
  },
  label: {
    color: theme.colors.textTertiary,
    fontFamily: theme.type.smallStrong.fontFamily,
    fontSize: theme.type.caption.size,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  matchup: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.bodyStrong.fontFamily,
    fontSize: theme.type.small.size,
  },
  score: {
    color: theme.colors.textSecondary,
    fontFamily: theme.type.body.fontFamily,
    fontSize: theme.type.caption.size,
  },
  scrollContent: {
    gap: theme.spacing.sm,
  },
  switchButton: {
    alignItems: 'center',
    borderColor: theme.colors.border,
    borderRadius: theme.radii.control,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  switchButtonPressed: {
    backgroundColor: theme.colors.accentMuted,
  },
  switchLabel: {
    color: theme.colors.textPrimary,
    fontFamily: theme.type.smallStrong.fontFamily,
    fontSize: theme.type.small.size,
  },
  wrap: {
    gap: theme.spacing.sm,
  },
});
