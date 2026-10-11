import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  RosterStripCard,
  SpreadLineCard,
  SurvivorBadgeCard,
  TotalLineCard,
} from '../../../components/StakeCards';
import { TextButton } from '../../../components/TextButton';
import { WatchlistFilters } from '../../../components/WatchlistFilters';
import { WeekCard } from '../../../components/WeekCard';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import { ApiRequestError } from '../../../lib/apiClient';
import { SHOW_BETS } from '../../../lib/featureFlags';
import { SHOW_STAR_TOGGLES } from '../../../lib/flags';
import { fonts } from '../../../lib/fonts';
import {
  disconnectLeague,
  fetchAllLineups,
  fetchLineup,
  renameManualLeague,
  setStarPlayer,
  syncLeague,
  type LeagueSummary,
  type LineupResponse,
  type LineupSlot,
  type OpponentStarter,
} from '../../../lib/leagues';
import { leagueChipScrollOffset, leagueChipWidth } from '../../../lib/leagueChipScroll';
import { orderLineupSlots, slotLabel } from '../../../lib/lineupOrder';
import { fetchMe, patchPreferences, type MeResponse } from '../../../lib/me';
import { fetchNflState } from '../../../lib/nflState';
import { opponentSectionState } from '../../../lib/opponentLineup';
import { formatGameLine, gameForTeam } from '../../../lib/playerGame';
import {
  fetchGamesLive,
  fetchGamesWeek,
  type LiveGame,
  type ScheduleGame,
} from '../../../lib/schedule';
import {
  pickedSideOf,
  rosterStripInputs,
  rosterStripModel,
  spreadLineModel,
  survivorBadgeModel,
  totalLineModel,
  type GameScore,
} from '../../../lib/stakeCards';
import { formatStakeLabel, stakeTeams, type ManualStake } from '../../../lib/stakes';
import { deleteStake, fetchStakes } from '../../../lib/stakesClient';
import { theme } from '../../../lib/theme';
import { isBenchSlot, watchedStarterCount, weekCardModel } from '../../../lib/weekCardModel';
import {
  lineupScreenMode,
  splitBets,
  useWatchlistFilter,
  watchlistSections,
} from '../../../lib/watchlistFilter';

const SWITCH_TRACK = { false: theme.colors.border, true: theme.colors.accent } as const;
const SWITCH_THUMB = theme.colors.textPrimary;
const STRIPE_WIDTH = 3;
const ROW_MIN_HEIGHT = 52;
/** Holds "FLEX" at the default eyebrow size; the column grows with the label. */
const SLOT_COLUMN_MIN_WIDTH = 44;

function rosterMeta(slot: LineupSlot): string {
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  if (team.length > 0 && position.length > 0) return `${team} · ${position}`;
  return team.length > 0 ? team : position;
}

/** DEF rows show the team name (`player.team.name`). A blank name falls back to the abbreviation. */
function playerDisplayName(slot: LineupSlot): string {
  const person = `${slot.player.first_name} ${slot.player.last_name}`.trim();
  if (slot.player.position.trim().toUpperCase() !== 'DEF') return person;
  const teamName = slot.player.team?.name.trim() ?? '';
  if (teamName.length > 0) return teamName;
  const abbreviation = slot.player.team?.abbreviation.trim() ?? '';
  return abbreviation.length > 0 ? abbreviation : person;
}

function rowAccessibilityLabel(slot: LineupSlot, gameLine: string | null): string {
  const name = playerDisplayName(slot);
  const team = slot.player.team?.abbreviation ?? '';
  const position = slot.player.position;
  const detail = [team, position].filter((part) => part.length > 0).join(' ');
  return [slotLabel(slot.position_in_lineup), name, detail, gameLine ?? '']
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * PLAN.md §10 Lineup tab — fantasy hub. Week comes from the lineup response.
 * This week's games load with it (no polling) so each row can show the game
 * and the player's team color. Star toggles stay behind
 * `SHOW_STAR_TOGGLES`. Pull-to-refresh syncs Sleeper.
 * Live points / detail sheet deferred.
 */

/** Empty `watchedLeagueIds` means nothing has been picked yet, which Home treats as watching every league. */
function isWatchingLeague(watchedIds: Set<string>, leagueId: string): boolean {
  return watchedIds.size === 0 || watchedIds.has(leagueId);
}

function weekEyebrow(week: number | null): string {
  return week == null ? 'FANTASY' : `WEEK ${week} · FANTASY`;
}

function stakeMeta(stake: ManualStake): string {
  if (!stake.game) return '';
  const matchup = `${stake.game.away_team} @ ${stake.game.home_team}`;
  const when = new Date(stake.game.scheduled_start);
  const time = Number.isNaN(when.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(when);
  return [matchup, time].filter((part) => part.length > 0).join(' · ');
}
export default function LineupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { leagues, leaguesRevision, refreshLeagues, deferConnect } = useLeaguesGate();

  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupResponse | null>(null);
  /** `null` when this week's games did not load — rows then omit the game line. */
  const [weekGames, setWeekGames] = useState<ScheduleGame[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  /** Optimistic `watchOpponent` while a preferences PATCH is in flight. */
  const [watchOpponentPending, setWatchOpponentPending] = useState<boolean | null>(null);
  const [bets, setBets] = useState<ManualStake[]>([]);
  /** False until this week's stakes load. A failed request stays false so the week card shows "—", not 0. */
  const [stakesKnown, setStakesKnown] = useState(false);
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [nflWeek, setNflWeek] = useState<number | null>(null);
  const [watchedStarterTotal, setWatchedStarterTotal] = useState<number | null>(null);
  const [filter, selectFilter] = useWatchlistFilter();
  const watchOpponentSave = useRef(false);
  const watchlist = lineupScreenMode(SHOW_BETS) === 'watchlist';

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.league_id === selectedLeagueId) ?? leagues[0] ?? null,
    [leagues, selectedLeagueId],
  );

  const watchedIds = useMemo(() => new Set(me?.preferences.watchedLeagueIds ?? []), [me]);

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
      setWeekGames(null);
      if (!SHOW_BETS) {
        setBets([]);
        setStakesKnown(false);
      }
      setLoadError(null);
      return;
    }
    setLoadError(null);
    try {
      const response = await fetchLineup(league.league_id);
      setLineup(response);
      if (SHOW_BETS) {
        try {
          const stakes = await fetchStakes(response.week);
          setBets(stakes.stakes);
          setStakesKnown(true);
        } catch {
          setBets([]);
          setStakesKnown(false);
        }
      }
      try {
        const slate = await fetchGamesWeek(response.week);
        setWeekGames(slate.games);
      } catch {
        setWeekGames(null);
      }
    } catch (error) {
      setLineup(null);
      setWeekGames(null);
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

  useEffect(() => {
    if (!SHOW_BETS) return;
    let cancelled = false;
    void fetchNflState()
      .then((state) => {
        if (!cancelled) setNflWeek(state.week);
      })
      .catch(() => {
        if (!cancelled) setNflWeek(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!SHOW_BETS || me == null) return;
    let cancelled = false;
    const watched = me.preferences.watchedLeagueIds;
    const targets =
      watched.length === 0
        ? leagues
        : leagues.filter((league) => watched.includes(league.league_id));
    void fetchAllLineups(targets)
      .then((rows) => {
        if (cancelled) return;
        if (targets.length > 0 && rows.length === 0) {
          setWatchedStarterTotal(null);
          return;
        }
        setWatchedStarterTotal(
          watchedStarterCount(
            rows.map((row) => ({ leagueId: row.league_id, slots: row.slots })),
            watched,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setWatchedStarterTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [leagues, me]);

  useFocusEffect(
    useCallback(() => {
      if (!SHOW_BETS) return;
      const week = lineup?.week ?? nflWeek;
      if (week == null) return;
      void fetchStakes(week)
        .then((response) => {
          setBets(response.stakes);
          setStakesKnown(true);
        })
        .catch(() => {
          setBets([]);
          setStakesKnown(false);
        });
      void fetchGamesLive()
        .then((response) => setLiveGames(response.games))
        .catch(() => setLiveGames([]));
    }, [lineup?.week, nflWeek]),
  );

  const confirmRemoveBet = (stake: ManualStake) => {
    const label = formatStakeLabel(stake, stakeTeams(stake));
    Alert.alert('Remove this bet?', label, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteStake(stake.id);
              setBets((current) => current.filter((row) => row.id !== stake.id));
            } catch (error) {
              Alert.alert('Could not remove', errorMessage(error));
            }
          })();
        },
      },
    ]);
  };

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
  const orderedSlots = useMemo(() => orderLineupSlots(lineup?.slots ?? []), [lineup]);
  const starterSlots = orderedSlots.filter((slot) => !isBenchSlot(slot));
  const benchSlots = orderedSlots.filter((slot) => isBenchSlot(slot));
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  const watchOpponent = watchOpponentPending ?? me?.preferences.watchOpponent ?? false;
  const opponentView = opponentSectionState(lineup?.opponent, watchOpponent);
  const { bets: propBets, pools: poolBets } = splitBets(bets);
  const sections = watchlistSections(filter);
  const showLeagueChips = !watchlist || sections.includes('leagueChips');
  const showRoster = !watchlist || sections.includes('starters');
  const showOpponent = !watchlist || sections.includes('opponent');
  const showActions = watchlist && sections.includes('leagueActions');
  const showPropBets = watchlist && sections.includes('bets');
  const showPools = watchlist && sections.includes('pools');
  const weekCard = weekCardModel({
    starterCount: watchedStarterTotal,
    watchOpponent,
    betCount: stakesKnown ? propBets.length : null,
    survivorCount: stakesKnown ? poolBets.length : null,
    isPro: me?.subscription_tier === 'pro',
  });
  const headerWeek = watchlist ? (lineup?.week ?? nflWeek) : (lineup?.week ?? null);

  const onWatchOpponent = async (next: boolean) => {
    if (watchOpponentSave.current || next === watchOpponent) return;
    watchOpponentSave.current = true;
    setWatchOpponentPending(next);
    try {
      const updated = await patchPreferences({ watchOpponent: next });
      setMe(updated);
    } catch (error) {
      Alert.alert('Could not update', errorMessage(error));
    } finally {
      setWatchOpponentPending(null);
      watchOpponentSave.current = false;
    }
  };

  const watchingSelected =
    selectedLeague != null && isWatchingLeague(watchedIds, selectedLeague.league_id);
  const manageBusy = busyLeagueId != null && busyLeagueId === selectedLeague?.league_id;

  const runLeagueAction = (choice: string | undefined) => {
    if (!selectedLeague || manageBusy) return;
    if (choice === 'Sync') {
      void (async () => {
        setBusyLeagueId(selectedLeague.league_id);
        try {
          await syncLeague(selectedLeague.league_id);
          const rows = await refreshLeagues();
          const next = rows.find((league) => league.league_id === selectedLeague.league_id) ?? null;
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
  };

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
        if (choice === 'Connect another team') {
          router.push('/(app)/connect-team');
          return;
        }
        runLeagueAction(choice);
      },
    );
  };

  if (isLoading && !lineup) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + theme.spacing.lg }]}>
        {watchlist ? <WatchlistHeader week={nflWeek} /> : <LineupHeader week={null} />}
        <LoadingState message="Loading lineup…" />
      </View>
    );
  }

  if (leagues.length === 0 && !watchlist) {
    return (
      <View
        style={[styles.screen, styles.emptyScreen, { paddingTop: insets.top + theme.spacing.lg }]}
      >
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
        {
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.huge,
        },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.colors.accent}
        />
      }
    >
      {watchlist ? <WatchlistHeader week={headerWeek} /> : <LineupHeader week={headerWeek} />}

      {watchlist ? (
        <>
          <WeekCard
            model={weekCard}
            onAddStake={() => {
              router.push('/(app)/add-stake');
            }}
          />
          <WatchlistFilters onChange={selectFilter} value={filter} />
        </>
      ) : null}

      {showActions ? (
        <View style={styles.leagueActions}>
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
            LEAGUE
          </Text>
          <View style={styles.leagueActionRow}>
            <TextButton
              label="Connect"
              onPress={() => {
                router.push('/(app)/connect-team');
              }}
              size="smallStrong"
            />
            {selectedLeague?.platform === 'sleeper' ? (
              <TextButton
                disabled={manageBusy}
                label="Sync"
                onPress={() => runLeagueAction('Sync')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
              <TextButton
                disabled={manageBusy}
                label="Edit lineup"
                onPress={() => runLeagueAction('Edit lineup')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
              <TextButton
                disabled={manageBusy}
                label="Rename"
                onPress={() => runLeagueAction('Rename')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague ? (
              <TextButton
                disabled={manageBusy}
                label="Disconnect"
                onPress={() => runLeagueAction('Disconnect')}
                size="smallStrong"
                tone="danger"
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {showLeagueChips ? (
        <View style={styles.switcherBlock}>
          <LeagueSwitcher
            leagues={leagues}
            selectedLeagueId={selectedLeague?.league_id ?? null}
            onSelect={setSelectedLeagueId}
          />
          {selectedLeague ? (
            <Text
              maxFontSizeMultiplier={theme.fontScaleCaps.dense}
              style={watchingSelected ? styles.watching : styles.notWatching}
            >
              {watchingSelected ? 'WATCHING' : 'NOT WATCHING'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {watchlist && sections.includes('leagueActions') ? (
        <RosterStripCard
          segments={rosterStripModel(
            rosterStripInputs(
              starterSlots.map((slot) => ({ teamAbbr: slot.player.team?.abbreviation ?? null })),
              (weekGames ?? []).map((game) => ({
                gameId: game.game_id,
                home: game.home_team,
                away: game.away_team,
                kickoffLabel: formatGameLine(
                  gameForTeam([game], game.home_team, now),
                  now,
                  timeZone,
                ),
              })),
            ),
          )}
        />
      ) : null}

      <View style={styles.rosterSection}>
        {showRoster ? (
          <>
            <View style={styles.rosterHeader}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
                STARTERS
              </Text>
              {selectedLeague && !watchlist ? (
                <TextButton
                  disabled={manageBusy}
                  label="Manage"
                  onPress={openManage}
                  size="smallStrong"
                />
              ) : null}
            </View>

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
                        now={now}
                        onToggleStar={(value) => {
                          void toggleStar(slot, value);
                        }}
                        saving={savingSlotId === slot.slot_id || !lineup}
                        slot={slot}
                        timeZone={timeZone}
                        weekGames={weekGames}
                      />
                    ))}
                  </View>
                ) : null}
                {benchSlots.length > 0 ? (
                  <>
                    <Text
                      maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                      style={styles.benchEyebrow}
                    >
                      BENCH
                    </Text>
                    <View style={styles.rosterWell}>
                      {benchSlots.map((slot, index) => (
                        <PlayerRow
                          divided={index > 0}
                          key={slot.slot_id}
                          mutedName
                          now={now}
                          onToggleStar={(value) => {
                            void toggleStar(slot, value);
                          }}
                          saving={savingSlotId === slot.slot_id || !lineup}
                          slot={slot}
                          timeZone={timeZone}
                          weekGames={weekGames}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {showPropBets ? (
          <BetGroup
            empty="No bets this week."
            liveGames={liveGames}
            onRemove={confirmRemoveBet}
            stakes={propBets}
            title="BETS"
            weekGames={weekGames}
          />
        ) : null}
        {showPools ? (
          <BetGroup
            empty="No pools this week."
            liveGames={liveGames}
            onRemove={confirmRemoveBet}
            stakes={poolBets}
            title="POOLS"
            weekGames={weekGames}
          />
        ) : null}

        {!watchlist && SHOW_BETS ? (
          <View style={styles.opponentSection}>
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
              BETS
            </Text>
            <TextButton
              label="Add a stake"
              onPress={() => {
                router.push('/(app)/add-stake');
              }}
            />
            {bets.length === 0 ? (
              <Text style={styles.emptyCopy}>No bets this week.</Text>
            ) : (
              bets.map((stake) => (
                <View key={stake.id} style={styles.betRow}>
                  <View style={styles.playerInfo}>
                    <Text
                      maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                      style={styles.playerName}
                    >
                      {formatStakeLabel(stake, stakeTeams(stake))}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                      style={styles.playerMeta}
                    >
                      {stakeMeta(stake)}
                    </Text>
                  </View>
                  <TextButton
                    label="Remove"
                    onPress={() => confirmRemoveBet(stake)}
                    tone="danger"
                  />
                </View>
              ))
            )}
          </View>
        ) : null}

        {showOpponent && opponentView !== 'hidden' && lineup?.opponent ? (
          <View style={styles.opponentSection}>
            <View style={styles.opponentHeader}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
                OPPONENT
              </Text>
              <View style={styles.opponentToggle}>
                <Text
                  maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                  style={styles.opponentToggleLabel}
                >
                  Also watch my opponent
                </Text>
                <Switch
                  accessibilityLabel="Also watch my opponent"
                  onValueChange={(value) => {
                    void onWatchOpponent(value);
                  }}
                  thumbColor={SWITCH_THUMB}
                  trackColor={SWITCH_TRACK}
                  value={watchOpponent}
                />
              </View>
            </View>
            {opponentView === 'off' ? (
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.opponentHint}>
                See your opponent's red-zone trips on Home. No notifications.
              </Text>
            ) : (
              <View style={styles.rosterWell}>
                {lineup.opponent.starters.map((starter, index) => (
                  <PlayerRow
                    divided={index > 0}
                    key={starter.player_id}
                    mutedName
                    now={now}
                    onToggleStar={() => undefined}
                    saving={false}
                    showTeamStripe={false}
                    slot={opponentStarterSlot(starter)}
                    timeZone={timeZone}
                    weekGames={weekGames}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function opponentStarterSlot(starter: OpponentStarter): LineupSlot {
  return {
    slot_id: starter.player_id,
    slot_type: 'starter',
    position_in_lineup:
      starter.slot_label != null && starter.slot_label.length > 0
        ? starter.slot_label
        : starter.position,
    is_star: false,
    player: {
      player_id: starter.player_id,
      first_name: starter.first_name,
      last_name: starter.last_name,
      position: starter.position,
      team: starter.team
        ? {
            teamId: starter.team.team_id,
            abbreviation: starter.team.abbreviation,
            name: starter.team.name,
          }
        : null,
    },
  };
}

function WatchlistHeader({ week }: { week: number | null }) {
  return (
    <View style={styles.headerBlock}>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
        {week == null ? 'WEEK' : `WEEK ${week}`}
      </Text>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.title} style={styles.screenTitle}>
        Watchlist
      </Text>
    </View>
  );
}

function BetGroup({
  title,
  empty,
  stakes,
  liveGames,
  weekGames,
  onRemove,
}: {
  title: string;
  empty: string;
  stakes: ManualStake[];
  liveGames: readonly LiveGame[];
  weekGames: ScheduleGame[] | null;
  onRemove: (stake: ManualStake) => void;
}) {
  return (
    <View style={styles.opponentSection}>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
        {title}
      </Text>
      {stakes.length === 0 ? (
        <Text style={styles.emptyCopy}>{empty}</Text>
      ) : (
        stakes.map((stake) => (
          <StakeEntry
            key={stake.id}
            liveGames={liveGames}
            onRemove={onRemove}
            stake={stake}
            weekGames={weekGames}
          />
        ))
      )}
    </View>
  );
}

function StakeEntry({
  stake,
  liveGames,
  weekGames,
  onRemove,
}: {
  stake: ManualStake;
  liveGames: readonly LiveGame[];
  weekGames: ScheduleGame[] | null;
  onRemove: (stake: ManualStake) => void;
}) {
  const type = stake.condition.type;
  const game = stake.game;
  const line = stake.condition.line;
  const side = game ? pickedSideOf(stake.subject.teamId, game) : null;
  const status = stakeStatus(stake, liveGames, weekGames);
  const score = stakeScore(stake, liveGames);

  if (type === 'SPREAD' && game && side && typeof line === 'number') {
    return (
      <View style={styles.stakeCard}>
        <SpreadLineCard
          axisLabel="14"
          kickoff={stakeKickoff(stake)}
          label={formatStakeLabel(stake, stakeTeams(stake))}
          matchup={stakeMatchup(stake)}
          model={spreadLineModel({ line, pickedSide: side, status, score })}
        />
        <TextButton label="Remove" onPress={() => onRemove(stake)} tone="danger" />
      </View>
    );
  }

  if ((type === 'TOTAL_OVER' || type === 'TOTAL_UNDER') && typeof line === 'number') {
    return (
      <View style={styles.stakeCard}>
        <TotalLineCard
          axisLabel="21"
          kickoff={stakeKickoff(stake)}
          label={formatStakeLabel(stake, stakeTeams(stake))}
          matchup={stakeMatchup(stake)}
          model={totalLineModel({
            line,
            side: type === 'TOTAL_OVER' ? 'over' : 'under',
            status,
            score,
          })}
        />
        <TextButton label="Remove" onPress={() => onRemove(stake)} tone="danger" />
      </View>
    );
  }

  if (type === 'SURVIVOR' && game && side) {
    const abbreviation =
      stakeTeams(stake).find((team) => team.teamId === stake.subject.teamId)?.abbreviation ??
      (side === 'home' ? game.home_team : game.away_team);
    return (
      <View style={styles.stakeCard}>
        <SurvivorBadgeCard
          model={survivorBadgeModel({ abbreviation, pickedSide: side, status, score })}
        />
        <TextButton label="Remove" onPress={() => onRemove(stake)} tone="danger" />
      </View>
    );
  }

  return (
    <View style={styles.betRow}>
      <View style={styles.playerInfo}>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.playerName}>
          {formatStakeLabel(stake, stakeTeams(stake))}
        </Text>
        <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.playerMeta}>
          {stakeMeta(stake)}
        </Text>
      </View>
      <TextButton label="Remove" onPress={() => onRemove(stake)} tone="danger" />
    </View>
  );
}

function stakeStatus(
  stake: ManualStake,
  liveGames: readonly LiveGame[],
  weekGames: ScheduleGame[] | null,
): string {
  if (liveGames.some((game) => game.game_id === stake.game_id)) return 'in_progress';
  return (
    weekGames?.find((game) => game.game_id === stake.game_id)?.status ??
    stake.game?.status ??
    'scheduled'
  );
}

function stakeScore(stake: ManualStake, liveGames: readonly LiveGame[]): GameScore | null {
  return liveGames.find((game) => game.game_id === stake.game_id)?.score ?? null;
}

function stakeMatchup(stake: ManualStake): string {
  if (!stake.game) return '';
  return `${stake.game.away_team} @ ${stake.game.home_team}`;
}

function stakeKickoff(stake: ManualStake): string {
  if (!stake.game) return '';
  const when = new Date(stake.game.scheduled_start);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(when);
}

function LineupHeader({ week }: { week: number | null }) {
  return (
    <View style={styles.headerBlock}>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.eyebrow}>
        {weekEyebrow(week)}
      </Text>
      <Text style={styles.screenTitle}>Lineup</Text>
    </View>
  );
}

const SWITCHER_GAP = theme.spacing.xs;
const SWITCHER_INSET = theme.spacing.xs;

function LeagueSwitcher({
  leagues,
  selectedLeagueId,
  onSelect,
}: {
  leagues: LeagueSummary[];
  selectedLeagueId: string | null;
  onSelect: (leagueId: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrolls = leagues.length >= 3;
  // Leading inset is outside the chip lane, so the 2.3-chip formula still peeks at the track's right edge.
  const laneWidth = Math.max(0, viewportWidth - SWITCHER_INSET);
  const chipWidth = laneWidth > 0 ? leagueChipWidth(laneWidth, SWITCHER_GAP) : 0;
  const selectedIndex = leagues.findIndex((league) => league.league_id === selectedLeagueId);

  useEffect(() => {
    if (!scrolls || chipWidth <= 0 || selectedIndex < 0) return;
    const target = leagueChipScrollOffset({
      leagueCount: leagues.length,
      selectedIndex,
      chipWidth,
      gap: SWITCHER_GAP,
      viewportWidth,
      currentOffset: offsetRef.current,
      leadingInset: SWITCHER_INSET,
      trailingInset: SWITCHER_INSET,
    });
    if (Math.abs(target - offsetRef.current) < 0.5) return;
    offsetRef.current = target;
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [chipWidth, leagues.length, scrolls, selectedIndex, viewportWidth]);

  const chips = leagues.map((league) => {
    const selected = league.league_id === selectedLeagueId;
    return (
      <Pressable
        key={league.league_id}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onSelect(league.league_id)}
        style={[
          styles.switcherChip,
          scrolls ? { width: chipWidth } : styles.switcherChipFill,
          selected && styles.switcherChipSelected,
        ]}
      >
        <Text
          ellipsizeMode="tail"
          maxFontSizeMultiplier={theme.fontScaleCaps.dense}
          numberOfLines={1}
          style={[styles.switcherChipLabel, selected && styles.switcherChipLabelSelected]}
        >
          {league.name}
        </Text>
      </Pressable>
    );
  });

  if (!scrolls) {
    return <View style={[styles.switcherTrack, styles.switcherFit]}>{chips}</View>;
  }

  return (
    <View style={[styles.switcherTrack, styles.switcherScrollTrack]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        contentContainerStyle={styles.switcherContent}
        onLayout={(event) => {
          const width = event.nativeEvent.layout.width;
          setViewportWidth((current) => (current === width ? current : width));
        }}
        onScroll={(event) => {
          offsetRef.current = event.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.switcherScroll}
      >
        {chips}
      </ScrollView>
    </View>
  );
}

function PlayerRow({
  slot,
  divided,
  mutedName,
  saving,
  weekGames,
  now,
  timeZone,
  onToggleStar,
  showTeamStripe = true,
}: {
  slot: LineupSlot;
  divided: boolean;
  mutedName: boolean;
  saving: boolean;
  weekGames: ScheduleGame[] | null;
  now: Date;
  timeZone: string;
  onToggleStar: (value: boolean) => void;
  /** Opponent rows keep the column and skip the team-color stripe. */
  showTeamStripe?: boolean;
}) {
  const name = playerDisplayName(slot);
  const teamId = slot.player.team?.abbreviation ?? '';
  const game = weekGames == null ? null : gameForTeam(weekGames, teamId, now);
  const gameLine = game == null ? null : formatGameLine(game, now, timeZone);
  const teamColor =
    game != null && game.kind !== 'bye' && game.teamColor != null ? game.teamColor : null;
  const stripeColor = showTeamStripe && teamColor != null ? teamColor : theme.colors.wellBorder;
  return (
    <View style={[styles.playerRow, divided && styles.playerRowDivider]}>
      <View style={[styles.stripe, { backgroundColor: stripeColor }]} />
      <View
        accessibilityLabel={rowAccessibilityLabel(slot, gameLine)}
        accessible
        style={styles.playerMain}
      >
        <View style={styles.slotColumn}>
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={styles.slotTag}
          >
            {slotLabel(slot.position_in_lineup)}
          </Text>
        </View>
        <View style={styles.playerInfo}>
          <Text numberOfLines={1} style={[styles.playerName, mutedName && styles.benchName]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.playerMeta}>
            {rosterMeta(slot)}
          </Text>
        </View>
        {gameLine ? (
          <Text
            maxFontSizeMultiplier={theme.fontScaleCaps.dense}
            numberOfLines={1}
            style={[styles.gameLine, gameLineToneStyle(gameLine)]}
          >
            {gameLine}
          </Text>
        ) : null}
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

function gameLineToneStyle(line: string): { color: string } | null {
  if (line === 'LIVE') return styles.gameLineLive;
  if (line.startsWith('TODAY')) return styles.gameLineToday;
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  content: {
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg2,
  },
  stakeCard: {
    gap: theme.spacing.sm,
  },
  betRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    minHeight: ROW_MIN_HEIGHT,
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
  gameLine: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.ticker.size,
    fontVariant: [...theme.type.ticker.fontVariant],
    fontWeight: '400',
  },
  gameLineLive: {
    color: theme.colors.flare,
  },
  gameLineToday: {
    color: theme.colors.accent,
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
  leagueActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  leagueActions: {
    gap: theme.spacing.sm,
  },
  opponentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  opponentHint: {
    color: theme.colors.textTertiary,
    fontSize: theme.type.body.size,
  },
  opponentSection: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  opponentToggle: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: theme.spacing.sm,
  },
  opponentToggleLabel: {
    color: theme.colors.textSecondary,
    flexShrink: 1,
    fontSize: theme.type.body.size,
  },
  notWatching: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  // Basis stays auto. `flex: 1` (basis 0) measures this column at width 0 once the
  // slot width comes from its label, and the name then lays out as a tall line box.
  playerInfo: {
    flexGrow: 1,
    flexShrink: 1,
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
    justifyContent: 'space-between',
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
  // Floor is on the view, not the text. A min width on the text itself was
  // measured as a wide column and stretched the row.
  slotColumn: {
    flexShrink: 0,
    justifyContent: 'center',
    marginLeft: theme.spacing.md,
    minWidth: SLOT_COLUMN_MIN_WIDTH,
  },
  slotTag: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textTransform: 'uppercase',
  },
  stripe: {
    alignSelf: 'stretch',
    width: STRIPE_WIDTH,
  },
  switcherBlock: {
    gap: theme.spacing.sm,
  },
  switcherChip: {
    alignItems: 'center',
    borderRadius: theme.radii.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  switcherChipFill: {
    flex: 1,
  },
  switcherChipLabel: {
    color: theme.colors.textTertiary,
    fontFamily: fonts.monoMedium,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
    textAlign: 'center',
    textTransform: 'uppercase',
    width: '100%',
  },
  switcherChipLabelSelected: {
    color: theme.colors.accent,
  },
  switcherChipSelected: {
    backgroundColor: theme.colors.surfaceRaised,
  },
  switcherContent: {
    alignItems: 'stretch',
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  },
  switcherFit: {
    flexDirection: 'row',
    padding: theme.spacing.xs,
  },
  switcherScroll: {
    flexGrow: 0,
    width: '100%',
  },
  switcherScrollTrack: {
    overflow: 'hidden',
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
