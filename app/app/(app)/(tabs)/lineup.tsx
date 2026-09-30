import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { SecondaryButton } from '../../../components/SecondaryButton';
import { TextButton } from '../../../components/TextButton';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import { ApiRequestError } from '../../../lib/apiClient';
import { SHOW_STAR_TOGGLES } from '../../../lib/flags';
import { fonts } from '../../../lib/fonts';
import {
  disconnectLeague,
  fetchLineup,
  renameManualLeague,
  setStarPlayer,
  syncLeague,
  type LeagueSummary,
  type LineupResponse,
} from '../../../lib/leagues';
import { orderLineupSlots, slotLabel } from '../../../lib/lineupOrder';
import { fetchMe, type MeResponse } from '../../../lib/me';
import { theme } from '../../../lib/theme';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;

/**
 * PLAN.md §10 Lineup tab — fantasy hub. Week comes from the lineup response
 * already loaded by `fetchLineup` (no extra request). Star toggles stay behind
 * `SHOW_STAR_TOGGLES`. Pull-to-refresh syncs Sleeper.
 * Live points / opponent / detail sheet deferred.
 */

/** Empty `watchedLeagueIds` means nothing has been picked yet, which Home treats as watching every league. */
function isWatchingLeague(watchedIds: Set<string>, leagueId: string): boolean {
  return watchedIds.size === 0 || watchedIds.has(leagueId);
}

function weekEyebrow(week: number | null): string {
  return week == null ? 'FANTASY' : `WEEK ${week} · FANTASY`;
}
export default function LineupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { leagues, leaguesRevision, refreshLeagues, deferConnect } = useLeaguesGate();

  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.league_id === selectedLeagueId) ?? leagues[0] ?? null,
    [leagues, selectedLeagueId],
  );

  const watchedIds = useMemo(
    () => new Set(me?.preferences.watchedLeagueIds ?? []),
    [me],
  );

  useEffect(() => {
    if (leagues.length === 0) {
      setSelectedLeagueId(null);
      return;
    }
    setSelectedLeagueId((current) => {
      if (current && leagues.some((league) => league.league_id === current)) {
        return current;
      }
      return leagues[0]?.league_id ?? null;
    });
  }, [leagues, leaguesRevision]);

  const loadLineup = useCallback(async (league: LeagueSummary | null) => {
    if (!league) {
      setLineup(null);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    try {
      setLineup(await fetchLineup(league.league_id));
    } catch (error) {
      setLineup(null);
      setLoadError(error instanceof ApiRequestError ? error.message : 'Could not load lineup.');
    }
  }, []);

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => {
        setMe(null);
      });
  }, [leaguesRevision]);

  useEffect(() => {
    setIsLoading(true);
    void loadLineup(selectedLeague).finally(() => setIsLoading(false));
  }, [loadLineup, selectedLeague, leaguesRevision]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (selectedLeague?.platform === 'sleeper') {
        await syncLeague(selectedLeague.league_id);
      }
      const [rows, meResponse] = await Promise.all([refreshLeagues(), fetchMe()]);
      setMe(meResponse);
      const next =
        rows.find((league) => league.league_id === selectedLeague?.league_id) ?? rows[0] ?? null;
      await loadLineup(next);
    } catch (error) {
      Alert.alert('Refresh failed', errorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [loadLineup, refreshLeagues, selectedLeague]);

  const promptRename = (league: LeagueSummary) => {
    Alert.prompt(
      'Rename league',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const next = value?.trim() ?? '';
            if (next.length === 0 || next === league.name) return;
            void (async () => {
              setBusyLeagueId(league.league_id);
              try {
                await renameManualLeague(league.league_id, next);
                await refreshLeagues();
              } catch (error) {
                Alert.alert('Could not rename', errorMessage(error));
              } finally {
                setBusyLeagueId(null);
              }
            })();
          },
        },
      ],
      'plain-text',
      league.name,
    );
  };

  // Load, pull-to-refresh, and Sync all write `lineup` through `loadLineup`.
  const orderedSlots = useMemo(
    () => orderLineupSlots(lineup?.slots ?? []),
    [lineup],
  );

  const watchingSelected =
    selectedLeague != null && isWatchingLeague(watchedIds, selectedLeague.league_id);
  const manageBusy = busyLeagueId != null && busyLeagueId === selectedLeague?.league_id;

  const openManage = () => {
    if (!selectedLeague || manageBusy) return;
    const sleeper = selectedLeague.platform === 'sleeper';
    const options = sleeper
      ? ['Sync', 'Connect another team', 'Disconnect', 'Cancel']
      : ['Edit lineup', 'Rename', 'Connect another team', 'Disconnect', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = options.indexOf('Disconnect');
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex, destructiveButtonIndex },
      (buttonIndex) => {
        const choice = options[buttonIndex];
        if (choice === 'Sync') {
          void (async () => {
            setBusyLeagueId(selectedLeague.league_id);
            try {
              await syncLeague(selectedLeague.league_id);
              const rows = await refreshLeagues();
              const next =
                rows.find((league) => league.league_id === selectedLeague.league_id) ?? null;
              await loadLineup(next);
            } catch (error) {
              Alert.alert('Sync failed', errorMessage(error));
            } finally {
              setBusyLeagueId(null);
            }
          })();
        } else if (choice === 'Edit lineup') {
          router.push(
            `/(app)/edit-manual-lineup?leagueId=${encodeURIComponent(selectedLeague.league_id)}`,
          );
        } else if (choice === 'Rename') {
          promptRename(selectedLeague);
        } else if (choice === 'Connect another team') {
          router.push('/(app)/connect-team');
        } else if (choice === 'Disconnect') {
          Alert.alert('Disconnect league?', `Remove "${selectedLeague.name}" from Pivot?`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Disconnect',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  setBusyLeagueId(selectedLeague.league_id);
                  try {
                    await disconnectLeague(selectedLeague.league_id);
                    const rows = await refreshLeagues();
                    if (rows.length === 0) {
                      deferConnect();
                    }
                  } catch (error) {
                    Alert.alert('Could not disconnect', errorMessage(error));
                  } finally {
                    setBusyLeagueId(null);
                  }
                })();
              },
            },
          ]);
        }
      },
    );
  };

  if (isLoading && !lineup) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <LineupHeader week={null} />
        <LoadingState message="Loading lineup…" />
      </View>
    );
  }

  if (leagues.length === 0) {
    return (
      <View style={[styles.screen, styles.emptyScreen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <LineupHeader week={null} />
        <Text style={styles.emptyCopy}>Connect a fantasy team to manage your lineup.</Text>
        <SecondaryButton
          label="Connect a team"
          onPress={() => router.push('/(app)/connect-team')}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.huge },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.colors.accent}
        />
      }
    >
      <LineupHeader week={lineup?.week ?? null} />

      <View style={styles.switcherBlock}>
        <LeagueSwitcher
          leagues={leagues}
          selectedLeagueId={selectedLeague?.league_id ?? null}
          onSelect={setSelectedLeagueId}
        />
        {selectedLeague ? (
          <Text style={watchingSelected ? styles.watching : styles.notWatching}>
            {watchingSelected ? 'WATCHING' : 'NOT WATCHING'}
          </Text>
        ) : null}
      </View>

      <View style={styles.rosterSection}>
        {selectedLeague ? (
          <View style={styles.rosterHeader}>
            <TextButton
              disabled={manageBusy}
              label="Manage"
              onPress={openManage}
              size="smallStrong"
            />
          </View>
        ) : null}

      {loadError ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            void loadLineup(selectedLeague);
          }}
        />
      ) : orderedSlots.length === 0 ? (
        <Text style={styles.emptyCopy}>No players in this lineup yet.</Text>
      ) : (
        <View style={styles.rosterList}>
          {orderedSlots.map((slot) => (
            <View key={slot.slot_id} style={styles.playerRow}>
              <Text style={styles.slotLabel}>{slotLabel(slot.position_in_lineup)}</Text>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName}>
                  {slot.player.first_name} {slot.player.last_name}
                </Text>
                <Text style={styles.playerMeta}>
                  {slot.player.position}
                  {slot.player.team?.abbreviation
                    ? ` · ${slot.player.team.abbreviation}`
                    : ''}
                </Text>
              </View>
              {SHOW_STAR_TOGGLES ? (
                <Switch
                  disabled={savingSlotId === slot.slot_id || !lineup}
                  onValueChange={async (value) => {
                    if (!lineup) return;
                    setSavingSlotId(slot.slot_id);
                    try {
                      await setStarPlayer(
                        lineup.league_id,
                        lineup.week,
                        slot.player.player_id,
                        value,
                      );
                      await loadLineup(selectedLeague);
                    } catch (error) {
                      Alert.alert('Could not update star', errorMessage(error));
                    } finally {
                      setSavingSlotId(null);
                    }
                  }}
                  thumbColor={SWITCH_THUMB}
                  trackColor={SWITCH_TRACK}
                  value={slot.is_star}
                />
              ) : null}
            </View>
          ))}
        </View>
      )}
      </View>
    </ScrollView>
  );
}

function LineupHeader({ week }: { week: number | null }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.eyebrow}>{weekEyebrow(week)}</Text>
      <Text style={styles.screenTitle}>Lineup</Text>
    </View>
  );
}

function LeagueSwitcher({
  leagues,
  selectedLeagueId,
  onSelect,
}: {
  leagues: LeagueSummary[];
  selectedLeagueId: string | null;
  onSelect: (leagueId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.switcherContent}
      showsHorizontalScrollIndicator={false}
      style={styles.switcherTrack}
    >
      {leagues.map((league) => {
        const selected = league.league_id === selectedLeagueId;
        return (
          <Pressable
            key={league.league_id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(league.league_id)}
            style={[styles.switcherChip, selected && styles.switcherChipSelected]}
          >
            <Text style={[styles.switcherChipLabel, selected && styles.switcherChipLabelSelected]}>
              {league.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  emptyCopy: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.body.size,
    marginTop: theme.spacing.md,
  },
  emptyScreen: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  eyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  headerBlock: {
    gap: theme.spacing.xs,
  },
  notWatching: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  playerInfo: {
    flex: 1,
    paddingRight: theme.spacing.md,
  },
  playerMeta: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
    fontWeight: '400',
    marginTop: 2,
  },
  playerName: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.body.size,
    fontWeight: '400',
  },
  playerRow: {
    alignItems: 'center',
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
  },
  rosterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  rosterList: {
    marginTop: theme.spacing.sm,
  },
  rosterSection: {
    gap: theme.spacing.sm,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  screenTitle: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: theme.type.heading.size,
    fontWeight: '400',
  },
  slotLabel: {
    color: theme.colors.accent,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.caption.size,
    fontWeight: '400',
    letterSpacing: 0.4,
    width: 88,
  },
  switcherBlock: {
    gap: theme.spacing.sm,
  },
  switcherChip: {
    borderRadius: theme.radii.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  switcherChipLabel: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  switcherChipLabelSelected: {
    color: theme.colors.accent,
  },
  switcherChipSelected: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  switcherContent: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  },
  switcherTrack: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    flexGrow: 0,
  },
  watching: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
});
