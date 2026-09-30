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
  type LineupSlot,
} from '../../../lib/leagues';
import { orderLineupSlots, slotLabel } from '../../../lib/lineupOrder';
import { fetchMe, type MeResponse } from '../../../lib/me';
import { theme } from '../../../lib/theme';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;
const STRIPE_WIDTH = 3;
const ROW_MIN_HEIGHT = 52;
const SLOT_COLUMN_WIDTH = 44;

function isBenchSlot(slot: LineupSlot): boolean {
  if (slot.slot_type === 'bench') return true;
  const raw = slot.position_in_lineup.trim().toUpperCase();
  return raw === 'BN' || raw === 'BENCH' || raw === 'IR' || raw === 'TAXI';
}

function rosterMeta(slot: LineupSlot): string {
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  if (team.length > 0 && position.length > 0) return `${team} · ${position}`;
  return team.length > 0 ? team : position;
}

function rowAccessibilityLabel(slot: LineupSlot): string {
  const name = `${slot.player.first_name} ${slot.player.last_name}`.trim();
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  const detail = [team, position].filter((part) => part.length > 0).join(' ');
  return [slotLabel(slot.position_in_lineup), name, detail]
    .filter((part) => part.length > 0)
    .join(', ');
}

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
  const starterSlots = orderedSlots.filter((slot) => !isBenchSlot(slot));
  const benchSlots = orderedSlots.filter((slot) => isBenchSlot(slot));

  const toggleStar = async (slot: LineupSlot, value: boolean) => {
    if (!lineup) return;
    setSavingSlotId(slot.slot_id);
    try {
      await setStarPlayer(lineup.league_id, lineup.week, slot.player.player_id, value);
      await loadLineup(selectedLeague);
    } catch (error) {
      Alert.alert('Could not update star', errorMessage(error));
    } finally {
      setSavingSlotId(null);
    }
  };

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
        <>
          {starterSlots.length > 0 ? (
            <View style={styles.rosterWell}>
              {starterSlots.map((slot, index) => (
                <PlayerRow
                  divided={index > 0}
                  key={slot.slot_id}
                  mutedName={false}
                  onToggleStar={(value) => {
                    void toggleStar(slot, value);
                  }}
                  saving={savingSlotId === slot.slot_id || !lineup}
                  slot={slot}
                />
              ))}
            </View>
          ) : null}
          {benchSlots.length > 0 ? (
            <>
              <Text style={styles.benchEyebrow}>BENCH</Text>
              <View style={styles.rosterWell}>
                {benchSlots.map((slot, index) => (
                  <PlayerRow
                    divided={index > 0}
                    key={slot.slot_id}
                    mutedName
                    onToggleStar={(value) => {
                      void toggleStar(slot, value);
                    }}
                    saving={savingSlotId === slot.slot_id || !lineup}
                    slot={slot}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
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

function PlayerRow({
  slot,
  divided,
  mutedName,
  saving,
  onToggleStar,
}: {
  slot: LineupSlot;
  divided: boolean;
  mutedName: boolean;
  saving: boolean;
  onToggleStar: (value: boolean) => void;
}) {
  const name = `${slot.player.first_name} ${slot.player.last_name}`.trim();
  return (
    <View style={[styles.playerRow, divided && styles.playerRowDivider]}>
      {/* Lineup payload has no team primary color, and app/lib/teamColors.ts does not exist.
          Board rows use accent when a catalog hex is missing. */}
      <View style={styles.stripe} />
      <View
        accessibilityLabel={rowAccessibilityLabel(slot)}
        accessible
        style={styles.playerMain}
      >
        <Text numberOfLines={1} style={styles.slotTag}>
          {slotLabel(slot.position_in_lineup)}
        </Text>
        <View style={styles.playerInfo}>
          <Text numberOfLines={1} style={[styles.playerName, mutedName && styles.benchName]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.playerMeta}>
            {rosterMeta(slot)}
          </Text>
        </View>
      </View>
      {SHOW_STAR_TOGGLES ? (
        <Switch
          disabled={saving}
          onValueChange={onToggleStar}
          thumbColor={SWITCH_THUMB}
          trackColor={SWITCH_TRACK}
          value={slot.is_star}
        />
      ) : null}
    </View>
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
  benchEyebrow: {
    color: theme.colors.brass,
    fontFamily: theme.type.eyebrow.fontFamily,
    fontSize: theme.type.eyebrow.size,
    fontWeight: theme.type.eyebrow.weight,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  benchName: {
    color: theme.colors.textSecondary,
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
    paddingRight: theme.spacing.sm,
  },
  playerMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
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
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
    paddingRight: theme.spacing.md,
  },
  playerRowDivider: {
    borderTopColor: theme.colors.rowDivider,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rosterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  rosterSection: {
    gap: theme.spacing.sm,
  },
  rosterWell: {
    backgroundColor: theme.colors.well,
    borderColor: theme.colors.wellBorder,
    borderRadius: theme.radii.md,
    borderWidth: theme.effects.panelBorderWidth,
    overflow: 'hidden',
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
  slotTag: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    marginLeft: theme.spacing.md,
    textTransform: 'uppercase',
    width: SLOT_COLUMN_WIDTH,
  },
  stripe: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.accent,
    width: STRIPE_WIDTH,
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
