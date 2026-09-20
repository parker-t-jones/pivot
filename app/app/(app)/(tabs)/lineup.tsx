import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { formatPositionInLineup, sortLineupSlots } from '../../../lib/lineupDisplay';
import { fetchMe, type MeResponse } from '../../../lib/me';
import { theme } from '../../../lib/theme';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;

/**
 * PLAN.md §10 Lineup tab — fantasy hub: league switcher + manage, roster in Sleeper
 * slot order (`position_in_lineup`), star toggles, pull-to-refresh Sleeper sync.
 * Live points / opponent / detail sheet deferred.
 */
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

  const orderedSlots = useMemo(
    () => sortLineupSlots(lineup?.slots ?? []),
    [lineup],
  );

  if (isLoading && !lineup) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <Text style={styles.screenTitle}>Lineup</Text>
        <LoadingState message="Loading lineup…" />
      </View>
    );
  }

  if (leagues.length === 0) {
    return (
      <View style={[styles.screen, styles.emptyScreen, { paddingTop: insets.top + theme.spacing.lg }]}>
        <Text style={styles.screenTitle}>Lineup</Text>
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
      <Text style={styles.screenTitle}>Lineup</Text>

      <LeagueSwitcher
        leagues={leagues}
        selectedLeagueId={selectedLeague?.league_id ?? null}
        watchedIds={watchedIds}
        onSelect={setSelectedLeagueId}
      />

      {selectedLeague ? (
        <LeagueManageRow
          league={selectedLeague}
          busy={busyLeagueId === selectedLeague.league_id}
          onConnectAnother={() => router.push('/(app)/connect-team')}
          onEditLineup={() =>
            router.push(
              `/(app)/edit-manual-lineup?leagueId=${encodeURIComponent(selectedLeague.league_id)}`,
            )
          }
          onRename={() => promptRename(selectedLeague)}
          onSync={async () => {
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
          }}
          onDisconnect={() =>
            Alert.alert('Disconnect league?', `Remove "${selectedLeague.name}" from Pivot?`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Disconnect',
                style: 'destructive',
                onPress: async () => {
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
                },
              },
            ])
          }
        />
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
              <Text style={styles.slotLabel}>{formatPositionInLineup(slot.position_in_lineup)}</Text>
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
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function LeagueSwitcher({
  leagues,
  selectedLeagueId,
  watchedIds,
  onSelect,
}: {
  leagues: LeagueSummary[];
  selectedLeagueId: string | null;
  watchedIds: Set<string>;
  onSelect: (leagueId: string) => void;
}) {
  if (leagues.length === 1) {
    const league = leagues[0]!;
    const watching = watchedIds.size === 0 || watchedIds.has(league.league_id);
    return (
      <View style={styles.switcherSingle}>
        <Text style={styles.leagueName}>{league.name}</Text>
        <Text style={styles.leagueMeta}>
          {league.platform === 'sleeper' ? 'Sleeper' : 'Manual'} · {league.season_year}
          {!watching ? ' · Not watching' : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.switcherList}>
      {leagues.map((league) => {
        const selected = league.league_id === selectedLeagueId;
        const watching = watchedIds.size === 0 || watchedIds.has(league.league_id);
        return (
          <Pressable
            key={league.league_id}
            accessibilityRole="button"
            onPress={() => onSelect(league.league_id)}
            style={[styles.switcherChip, selected && styles.switcherChipSelected]}
          >
            <Text style={[styles.switcherChipLabel, selected && styles.switcherChipLabelSelected]}>
              {league.name}
            </Text>
            {!watching ? <Text style={styles.notWatching}>Not watching</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function LeagueManageRow({
  league,
  busy,
  onConnectAnother,
  onEditLineup,
  onRename,
  onSync,
  onDisconnect,
}: {
  league: LeagueSummary;
  busy: boolean;
  onConnectAnother: () => void;
  onEditLineup: () => void;
  onRename: () => void;
  onSync: () => Promise<void>;
  onDisconnect: () => void;
}) {
  return (
    <View style={styles.manageBlock}>
      <View style={styles.manageActions}>
        {league.platform === 'sleeper' ? (
          <TextButton
            disabled={busy}
            label="Sync"
            onPress={() => void onSync()}
            size="smallStrong"
          />
        ) : (
          <>
            <TextButton
              disabled={busy}
              label="Edit lineup"
              onPress={onEditLineup}
              size="smallStrong"
            />
            <TextButton disabled={busy} label="Rename" onPress={onRename} size="smallStrong" />
          </>
        )}
        <TextButton
          disabled={busy}
          label="Disconnect"
          onPress={onDisconnect}
          size="smallStrong"
          tone="danger"
        />
      </View>
      <SecondaryButton
        label="Connect another team"
        onPress={onConnectAnother}
        style={styles.connectAnother}
      />
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  connectAnother: {
    marginTop: theme.spacing.md,
  },
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
  leagueMeta: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.caption.size,
    fontWeight: '400',
    marginTop: theme.spacing.xs,
  },
  leagueName: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.sansBold,
    fontSize: theme.type.heading.size,
    fontWeight: '400',
  },
  manageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  manageBlock: {
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing.md,
  },
  notWatching: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
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
  rosterList: {
    marginTop: theme.spacing.sm,
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
  switcherChip: {
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  switcherChipLabel: {
    color: theme.colors.textSecondary,
    fontFamily: fonts.sansSemiBold,
    fontSize: theme.type.caption.size,
    fontWeight: '400',
  },
  switcherChipLabelSelected: {
    color: theme.colors.accent,
  },
  switcherChipSelected: {
    backgroundColor: theme.colors.accentMuted,
    borderColor: theme.colors.accentBorder,
  },
  switcherList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  switcherSingle: {
    marginBottom: theme.spacing.xs,
  },
});
