import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextButton } from './TextButton';
import { useUpgradeSheet } from '../contexts/UpgradeSheetContext';
import { resolveActiveLeagueId } from '../lib/activeLeague';
import { alertAsync } from '../lib/confirm';
import type { LeagueSummary } from '../lib/leagues';
import { fetchMe, patchPreferences, type MeResponse } from '../lib/me';
import { fonts } from '../lib/fonts';
import { theme } from '../lib/theme';
import { useDesktopTier } from '../lib/useDesktopTier';

function platformLabel(platform: string): string {
  if (platform === 'sleeper') return 'Sleeper';
  if (platform === 'espn') return 'ESPN';
  if (platform === 'manual') return 'Manual';
  return platform;
}

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
  const desktop = useDesktopTier() !== 'companion';
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState({ top: 72, right: theme.spacing.lg2 });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(me.preferences.watchedLeagueIds);
  const [saving, setSaving] = useState(false);
  // RN's `Modal` can't present on top of an already-presented native modal (see
  // `NotificationBannerHost`'s docstring for the same failure mode with the flag banner) — this
  // sheet is itself an RN `Modal`, so deferring `openUpgrade()` until `onDismiss` (rather than
  // firing it the instant `setOpen(false)` is called) avoids two modals racing to present.
  const pendingUpgradeRef = useRef(false);
  const onMeUpdatedRef = useRef(onMeUpdated);
  onMeUpdatedRef.current = onMeUpdated;

  const isPro = me.subscription_tier === 'pro';
  const watched = me.preferences.watchedLeagueIds;
  const watchedKey = JSON.stringify(watched);
  const watchedKeyRef = useRef(watchedKey);
  watchedKeyRef.current = watchedKey;
  const activeLeagueId = resolveActiveLeagueId(leagues, watched);
  const activeLeague = leagues.find((l) => l.league_id === activeLeagueId) ?? null;

  // Home keeps its own `me`. Refetch on focus so a Watchlist "Set as active"
  // shows up here without a shared context. Skip the reload when nothing changed.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchMe()
        .then((updated) => {
          if (cancelled) return;
          const nextKey = JSON.stringify(updated.preferences.watchedLeagueIds);
          if (nextKey === watchedKeyRef.current) return;
          onMeUpdatedRef.current(updated);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const openSheet = () => {
    setDraft(
      watched.length > 0
        ? watched.filter((id) => leagues.some((l) => l.league_id === id))
        : activeLeague
          ? [activeLeague.league_id]
          : [],
    );
    triggerRef.current?.measureInWindow((_x, y, _width, height) => {
      setAnchor({ top: y + height + theme.spacing.xs, right: theme.spacing.lg2 });
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="active-lineup-option"]'),
      );
      if (options.length === 0) return;
      const current = options.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = options[Math.max(0, Math.min(options.length - 1, current + step))] ?? options[0];
      next?.focus();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="active-lineup-option"]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
      void alertAsync('Could not save', error instanceof Error ? error.message : 'Try again.');
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
        void alertAsync('Pick a lineup', 'Watch at least one league.');
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

  // Nothing explicitly chosen yet (fresh account, or user never opened the picker). The
  // eyebrow stays "Active lineup"; the value prompts instead of a league name. Once the
  // user picks, this shows that league. Pro with several watched leagues keeps the count.
  const isPlaceholder = watched.length === 0;
  const value = isPlaceholder
    ? 'Choose a lineup'
    : isPro && watched.length > 1
      ? `${watched.length} lineups`
      : (activeLeague?.name ?? 'Choose a lineup');
  const platform =
    !isPlaceholder && !(isPro && watched.length > 1) && activeLeague
      ? platformLabel(activeLeague.platform)
      : null;

  return (
    <>
      <View ref={triggerRef} collapsable={false}>
        <Pressable
          accessibilityLabel="Active lineup"
          accessibilityRole="button"
          onPress={openSheet}
          style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
          testID="active-lineup-trigger"
        >
          <View style={styles.triggerCopy}>
            <Text style={styles.triggerEyebrow}>Active lineup</Text>
            <View style={styles.triggerValueRow}>
              <Text numberOfLines={1} style={styles.triggerLabel}>
                {value}
              </Text>
              {platform ? (
                <Text numberOfLines={1} style={styles.triggerPlatform}>
                  {platform}
                </Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.triggerChevron}>▾</Text>
        </Pressable>
      </View>

      <Modal
        animationType={desktop ? 'none' : 'slide'}
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
        <View
          accessibilityRole="menu"
          style={desktop ? [styles.dropdown, { top: anchor.top, right: anchor.right }] : styles.sheet}
          testID={desktop ? 'active-lineup-dropdown' : 'active-lineup-sheet'}
        >
          <Text style={styles.sheetTitle}>{isPro ? 'Watch leagues' : 'Active lineup'}</Text>
          <Text style={styles.sheetHint}>
            {isPro
              ? 'Home and flags use every league you select.'
              : 'Free accounts watch one league. Upgrade to Pro to watch more.'}
          </Text>

          {leagues.map((league) => {
            const selected = draft.includes(league.league_id);
            return (
              <Pressable
                accessibilityRole="menuitem"
                disabled={saving}
                key={league.league_id}
                onPress={() => toggle(league.league_id)}
                style={[
                  styles.row,
                  selected && styles.rowSelected,
                  saving && styles.rowDisabled,
                ]}
                testID="active-lineup-option"
              >
                <Text style={styles.rowLabel}>{league.name}</Text>
                <Text style={styles.rowPlatform}>{platformLabel(league.platform)}</Text>
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
  dropdown: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.control,
    borderWidth: theme.effects.panelBorderWidth,
    paddingBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    position: 'absolute',
    width: 280,
    ...theme.effects.panelGlow,
  },
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
  rowPlatform: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    marginLeft: theme.spacing.sm,
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
    borderColor: theme.colors.border,
    borderRadius: theme.radii.control,
    borderWidth: theme.effects.panelBorderWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 280,
    minWidth: 160,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  triggerCopy: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  triggerEyebrow: {
    color: theme.colors.accent,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  triggerPressed: {
    opacity: theme.opacity.disabled,
  },
  triggerLabel: {
    color: theme.colors.textPrimary,
    flexShrink: 1,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.caption.size,
  },
  triggerPlatform: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.caption.size,
    marginLeft: theme.spacing.sm,
  },
  triggerValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 2,
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
