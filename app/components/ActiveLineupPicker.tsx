import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextButton } from './TextButton';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import type { LeagueSummary } from '../lib/leagues';
import { patchPreferences, type MeResponse } from '../lib/me';
import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';

interface ActiveLineupPickerProps {
  leagues: LeagueSummary[];
  me: MeResponse;
  onMeUpdated: (me: MeResponse) => void;
}

/**
 * Home header control — Free: pick one Active Lineup. Pro: multi-select + Select all.
 */
export function ActiveLineupPicker({ leagues, me, onMeUpdated }: ActiveLineupPickerProps) {
  const { openUpgrade } = useUpgradeSheet();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(me.preferences.watchedLeagueIds);
  const [saving, setSaving] = useState(false);
  // RN's `Modal` can't present on top of an already-presented native modal (see
  // `NotificationBannerHost`'s docstring for the same failure mode with the flag banner) — this
  // sheet is itself an RN `Modal`, so deferring `openUpgrade()` until `onDismiss` (rather than
  // firing it the instant `setOpen(false)` is called) avoids two modals racing to present.
  const pendingUpgradeRef = useRef(false);

  const isPro = me.subscription_tier === 'pro';
  const watched = me.preferences.watchedLeagueIds;
  const activeLeague =
    leagues.find((l) => watched.includes(l.league_id)) ?? leagues[0] ?? null;

  const openSheet = () => {
    setDraft(
      watched.length > 0
        ? watched.filter((id) => leagues.some((l) => l.league_id === id))
        : activeLeague
          ? [activeLeague.league_id]
          : [],
    );
    setOpen(true);
  };

  /**
   * Persists `next` immediately — every tap below takes effect right away, no separate Save
   * step. `onMeUpdated` propagates up to `HomeScreen`, so Home's card data (and this control's
   * own label) update live, even while this sheet is still open on top of it.
   */
  const persist = async (next: string[]) => {
    setSaving(true);
    try {
      const updated = await patchPreferences({ watchedLeagueIds: next });
      onMeUpdated(updated);
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try again.');
      setDraft(watched);
    } finally {
      setSaving(false);
    }
  };

  const selectFree = (leagueId: string) => {
    setDraft([leagueId]);
    void persist([leagueId]);
    setOpen(false);
  };

  const toggle = (leagueId: string) => {
    if (saving) return;
    if (!isPro) {
      selectFree(leagueId);
      return;
    }
    setDraft((current) => {
      const next = current.includes(leagueId)
        ? current.filter((id) => id !== leagueId)
        : [...current, leagueId];
      if (next.length === 0) {
        Alert.alert('Pick a lineup', 'Watch at least one league.');
        return current;
      }
      void persist(next);
      return next;
    });
  };

  const selectAll = () => {
    if (saving) return;
    const next = leagues.map((l) => l.league_id);
    setDraft(next);
    void persist(next);
  };

  if (leagues.length === 0) return null;

  // Nothing explicitly chosen yet (fresh account, or user never opened the picker) — the box
  // itself prompts "ACTIVE LINEUP" rather than silently defaulting to whichever league Home
  // happens to fall back to for its card data. Once the user picks, this shows their choice.
  const isPlaceholder = watched.length === 0;
  const label = isPlaceholder
    ? 'ACTIVE LINEUP'
    : isPro && watched.length > 1
      ? `${watched.length} lineups`
      : (activeLeague?.name ?? 'ACTIVE LINEUP');

  return (
    <>
      <Pressable
        accessibilityLabel="Active Lineup"
        accessibilityRole="button"
        onPress={openSheet}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <Text
          numberOfLines={1}
          style={isPlaceholder ? styles.triggerPlaceholder : styles.triggerLabel}
        >
          {label}
        </Text>
        <Text style={styles.triggerChevron}>▾</Text>
      </Pressable>

      <Modal
        animationType="slide"
        transparent
        visible={open}
        onRequestClose={() => setOpen(false)}
        onDismiss={() => {
          if (pendingUpgradeRef.current) {
            pendingUpgradeRef.current = false;
            openUpgrade();
          }
        }}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>
            {isPro ? 'Watch leagues' : 'Active Lineup'}
          </Text>
          <Text style={styles.sheetHint}>
            {isPro
              ? 'Home and flags use every league you select.'
              : 'Free accounts watch one league. Upgrade to Pro to watch more.'}
          </Text>

          {leagues.map((league) => {
            const selected = draft.includes(league.league_id);
            return (
              <Pressable
                disabled={saving}
                key={league.league_id}
                onPress={() => toggle(league.league_id)}
                style={[
                  styles.row,
                  selected && styles.rowSelected,
                  saving && styles.rowDisabled,
                ]}
              >
                <Text style={styles.rowLabel}>{league.name}</Text>
                <Text style={styles.rowCheck}>{selected ? '✓' : ''}</Text>
              </Pressable>
            );
          })}

          {isPro ? (
            <TextButton
              disabled={saving}
              label="Select all"
              onPress={selectAll}
              size="smallStrong"
              style={styles.proActions}
            />
          ) : (
            <TextButton
              label="Upgrade to Pro"
              onPress={() => {
                pendingUpgradeRef.current = true;
                setOpen(false);
              }}
              size="smallStrong"
              style={styles.upgradeLink}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  proActions: {
    marginTop: theme.spacing.sm,
  },
  row: {
    alignItems: 'center',
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  rowDisabled: {
    opacity: theme.opacity.disabled,
  },
  rowCheck: {
    color: theme.colors.accent,
    fontFamily: fonts.monoBold,
    fontSize: 16,
    width: 20,
  },
  rowLabel: {
    color: theme.colors.textPrimary,
    flex: 1,
    fontSize: theme.type.body.size,
    fontWeight: theme.type.bodyStrong.weight,
  },
  rowSelected: {
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accentBorder,
  },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopColor: theme.colors.accentBorder,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    borderTopWidth: theme.effects.panelBorderWidth,
    bottom: 0,
    left: 0,
    paddingBottom: theme.spacing.huge,
    paddingHorizontal: theme.spacing.lg2,
    paddingTop: theme.spacing.lg,
    position: 'absolute',
    right: 0,
    ...theme.effects.panelGlow,
  },
  sheetHint: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    marginTop: theme.spacing.xs,
  },
  sheetTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.heading.size,
    fontWeight: theme.type.heading.weight,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accentBorder,
    borderRadius: theme.radii.control,
    borderWidth: theme.effects.panelBorderWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 180,
    minWidth: 132,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    ...theme.effects.panelGlow,
  },
  triggerPressed: {
    opacity: theme.opacity.disabled,
  },
  /** Placeholder state — nothing watched yet, so the box itself reads "ACTIVE LINEUP". */
  triggerPlaceholder: {
    color: theme.colors.accent,
    flex: 1,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginRight: theme.spacing.sm,
  },
  /** Selected state — smaller/secondary than the placeholder above so the box doesn't shout once
   *  a real league name is filling it. */
  triggerLabel: {
    color: theme.colors.textPrimary,
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.eyebrow.size - 2,
    fontWeight: '400',
    marginRight: theme.spacing.sm,
  },
  triggerChevron: {
    color: theme.colors.accent,
    fontFamily: fonts.monoBold,
    fontSize: 10,
  },
  upgradeLink: {
    marginTop: theme.spacing.md,
  },
});
