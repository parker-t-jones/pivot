import { useFocusEffect, useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActionSheetIOS,
  Alert,
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DemoEditingBanner } from '../../../components/DemoEditingBanner';
import { FantasyLeagueCard } from '../../../components/FantasyLeagueCard';
import { ErrorState } from '../../../components/ErrorState';
import { ColdLoading } from '../../../components/ColdLoading';
import { useLoadingPlaceholder, useSlowLoading } from '../../../lib/useSlowLoading';
import { LoadingState } from '../../../components/LoadingState';
import { SecondaryButton } from '../../../components/SecondaryButton';
import { PickCard } from '../../../components/PickCard';
import { PickEventFlash } from '../../../components/PickEventFlash';
import { RosterStripCard } from '../../../components/StakeCards';
import { ShareableCard } from '../../../components/ShareableCard';
import { SwipeToRemove } from '../../../components/SwipeToRemove';
import { TextButton } from '../../../components/TextButton';
import { WatchlistDesktop } from '../../../components/WatchlistDesktop';
import { WatchlistFilters } from '../../../components/WatchlistFilters';
import { WeekCard } from '../../../components/WeekCard';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import {
  resolveActiveLeagueId,
  watchedLeagueIdsForOpen,
  watchlistChipCue,
  watchlistLeagueOnOpen,
  watchlistLeagueSelection,
} from '../../../lib/activeLeague';
import { ApiRequestError } from '../../../lib/apiClient';
import {
  allTabLeagues,
  fantasyLeagueCardModel,
  liveTeamAbbrs,
  useLeagueExpansion,
} from '../../../lib/fantasyLeagueCard';
import { alertAsync, confirmAsync } from '../../../lib/confirm';
import { useFeature } from '../../../lib/useFeature';
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
import { weekCardShareContent, type ShareContent } from '../../../lib/shareCard';
import { useShareCard } from '../../../lib/useShareCard';
import {
  lineupLoadingMessage,
  readRememberedWatchlist,
  rememberWatchlist,
  showFullLoading,
} from '../../../lib/lineupLoading';
import { orderLineupSlots, slotLabel } from '../../../lib/lineupOrder';
import { fetchMe, patchPreferences, type MeResponse } from '../../../lib/me';
import { fetchNflState } from '../../../lib/nflState';
import { opponentEmptyCopy, opponentSectionState } from '../../../lib/opponentLineup';
import { formatGameLine, gameForTeam } from '../../../lib/playerGame';
import {
  fetchGamesLive,
  fetchGamesWeek,
  type LiveGame,
  type ScheduleGame,
} from '../../../lib/schedule';
import { pickCardModel } from '../../../lib/pickCard';
import { orderPicks } from '../../../lib/pickOrder';
import { rosterStripInputs, rosterStripModel } from '../../../lib/stakeCards';
import {
  removalKeepsFreeSlot,
  removePickMessage,
  stakeGameIds,
  stakeTeams,
  type ManualStake,
} from '../../../lib/stakes';
import { subscribeAddPickSaved } from '../../../lib/addPickDrawer';
import {
  bindStakeUndoCommit,
  flushStakeUndo,
  getStakeUndoState,
  hideStake,
  subscribeStakeUndo,
  takePendingStakeUndo,
} from '../../../lib/stakeUndoStore';
import { supabase } from '../../../lib/supabase';
import {
  deleteWatchPick,
  deleteWatchPickKeepalive,
  fetchWatchPicks,
} from '../../../lib/picksClient';
import { watchPickLabel } from '../../../lib/watchPicks';
import { theme } from '../../../lib/theme';
import { useOpenAddPick } from '../../../lib/useOpenAddPick';
import { useDesktopTier } from '../../../lib/useDesktopTier';
import { usePickHitFlash } from '../../../lib/usePickHitFlash';
import {
  browsedStarterCount,
  cardGameCount,
  freeBetCount,
  isBenchSlot,
  opponentStripStatus,
  sparseBetPrompt,
  watchedStarterCount,
  weekCardModel,
} from '../../../lib/weekCardModel';
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
  const knownWatchedRef = useRef<readonly string[] | null>(
    readRememberedWatchlist()?.watchedLeagueIds ?? null,
  );

  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(() => {
    const watchedLeagueIds = knownWatchedRef.current;
    if (watchedLeagueIds == null) return null;
    return watchlistLeagueOnOpen({ leagues, watchedLeagueIds });
  });
  const [lineup, setLineup] = useState<LineupResponse | null>(
    () => readRememberedWatchlist()?.lineup ?? null,
  );
  /** `null` when this week's games did not load — rows then omit the game line. */
  const [weekGames, setWeekGames] = useState<ScheduleGame[] | null>(
    () => readRememberedWatchlist()?.weekGames ?? null,
  );
  const [isLoading, setIsLoading] = useState(() => readRememberedWatchlist()?.lineup == null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyLeagueId, setBusyLeagueId] = useState<string | null>(null);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(() => readRememberedWatchlist()?.me ?? null);
  const [settingActive, setSettingActive] = useState(false);
  /** Optimistic `watchOpponent` while a preferences PATCH is in flight. */
  const [watchOpponentPending, setWatchOpponentPending] = useState<boolean | null>(null);
  const [bets, setBets] = useState<ManualStake[]>(() => readRememberedWatchlist()?.bets ?? []);
  /** Free-cap picks removed after kickoff this week. They keep their free slots spent. */
  const [spentSlots, setSpentSlots] = useState(0);
  /** False until this week's stakes load. A failed request stays false so the week card shows "—", not 0. */
  const [stakesKnown, setStakesKnown] = useState(
    () => readRememberedWatchlist()?.stakesKnown ?? false,
  );
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [nflWeek, setNflWeek] = useState<number | null>(
    () => readRememberedWatchlist()?.nflWeek ?? null,
  );
  const [watchedStarterTotal, setWatchedStarterTotal] = useState<number | null>(
    () => readRememberedWatchlist()?.watchedStarterTotal ?? null,
  );
  /** All-tab league cards. Null until the watched leagues' lineups load; a failure stays null. */
  const [watchedLineups, setWatchedLineups] = useState<LineupResponse[] | null>(null);
  const [watchedLineupsFailed, setWatchedLineupsFailed] = useState(false);
  const leagueExpansion = useLeagueExpansion();
  const [filter, selectFilter] = useWatchlistFilter();
  const desktopTier = useDesktopTier();
  const openAddPick = useOpenAddPick();
  const watchOpponentSave = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let token: string | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      token = data.session?.access_token ?? null;
    });
    const onLeave = () => {
      if (!token) {
        flushStakeUndo();
        return;
      }
      const id = takePendingStakeUndo();
      const stake = id ? betsRef.current.find((row) => row.id === id) : undefined;
      if (stake) deleteWatchPickKeepalive(stake, token);
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      // Leaving Watchlist commits. Hiding a row does not unmount this screen.
      flushStakeUndo();
    };
  }, []);
  const betsOn = useFeature('bets');
  const watchlist = lineupScreenMode(betsOn) === 'watchlist';
  // Every refetch path lands in `bets`, so diffing here covers focus, pull, and add-pick saves.
  const pickFlash = usePickHitFlash(bets);
  // Share (issue #48): render the branded `ShareableCard` offscreen, then capture it. `null`
  // except for the brief window between a Share tap and the share sheet / web fallback closing.
  const [shareContent, setShareContent] = useState<ShareContent | null>(null);
  const shareViewRef = useRef<View>(null);
  const { share: shareCard } = useShareCard();
  useEffect(() => {
    if (!shareContent) return;
    let cancelled = false;
    const dialogTitle = shareContent.kind === 'week' ? 'Share your week card' : 'Share your pick';
    void (async () => {
      const result = await shareCard(shareViewRef, shareContent, dialogTitle);
      if (cancelled) return;
      setShareContent(null);
      if (!result.ok && result.reason !== 'unavailable') {
        void alertAsync('Could not share', 'Try again in a moment.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareCard, shareContent]);
  const withFlash = (screen: ReactNode) => (
    <View style={styles.flashHost}>
      {screen}
      <PickEventFlash flash={pickFlash.flash} onDone={pickFlash.dismiss} />
      {shareContent ? (
        <View
          collapsable={false}
          pointerEvents="none"
          ref={shareViewRef}
          style={styles.shareOffscreen}
        >
          <ShareableCard content={shareContent} />
        </View>
      ) : null}
    </View>
  );

  const leaguesRef = useRef(leagues);
  leaguesRef.current = leagues;
  const hasLineupRef = useRef(lineup != null);
  hasLineupRef.current = lineup != null;
  /** True once the focus refetch has settled, including a failure. */
  const openSettledRef = useRef(false);

  const activeLeagueId = resolveActiveLeagueId(
    leagues,
    me?.preferences.watchedLeagueIds ?? knownWatchedRef.current ?? [],
  );
  // A chip sets `selectedLeagueId` for this visit only. Mount and focus both
  // assign the active league, so a remembered browse does not survive a return.
  const selectedLeague = useMemo(() => {
    const browsed = leagues.find((league) => league.league_id === selectedLeagueId);
    if (browsed) return browsed;
    if (me == null && knownWatchedRef.current == null) return null;
    return leagues.find((league) => league.league_id === activeLeagueId) ?? null;
  }, [activeLeagueId, leagues, me, selectedLeagueId]);

  const selectActiveLeague = useCallback((watchedLeagueIds: readonly string[] | null) => {
    knownWatchedRef.current = watchedLeagueIds;
    openSettledRef.current = true;
    setSelectedLeagueId(watchlistLeagueOnOpen({ leagues: leaguesRef.current, watchedLeagueIds }));
  }, []);

  useEffect(() => {
    if (selectedLeagueId != null || leagues.length === 0) return;
    if (knownWatchedRef.current == null && !openSettledRef.current) return;
    setSelectedLeagueId(
      watchlistLeagueOnOpen({
        leagues,
        watchedLeagueIds: knownWatchedRef.current,
      }),
    );
  }, [leagues, selectedLeagueId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchMe()
        .then((meResponse) => {
          if (cancelled) return;
          setMe(meResponse);
          selectActiveLeague(
            watchedLeagueIdsForOpen({
              known: knownWatchedRef.current,
              fetched: meResponse.preferences.watchedLeagueIds,
            }),
          );
        })
        .catch(() => {
          if (cancelled) return;
          selectActiveLeague(
            watchedLeagueIdsForOpen({
              known: knownWatchedRef.current,
              fetched: null,
            }),
          );
        });
      return () => {
        cancelled = true;
      };
    }, [selectActiveLeague]),
  );

  const loadLineup = useCallback(
    async (league: LeagueSummary | null) => {
      if (!league) {
        setLineup(null);
        setWeekGames(null);
        if (!betsOn) {
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
        if (betsOn) {
          try {
            const stakes = await fetchWatchPicks(response.week);
            setBets(stakes.stakes);
            setSpentSlots(stakes.free_slots_spent ?? 0);
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
    },
    [betsOn],
  );

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => {
        setMe(null);
      });
  }, [leaguesRevision]);

  useEffect(() => {
    // Wait for `me` (or a chip / focus choice) so the first load is the active
    // league, not whichever row `GET /leagues` returned first.
    if (leagues.length > 0 && me == null && selectedLeagueId == null) return;
    let cancelled = false;
    // A Home → Watchlist return already has a lineup (in state, or remembered
    // across the remount). Refetch behind it; don't replace the screen.
    if (!hasLineupRef.current) setIsLoading(true);
    void loadLineup(selectedLeague).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [leagues.length, leaguesRevision, loadLineup, me, selectedLeague, selectedLeagueId]);

  useEffect(() => {
    if (!betsOn) return;
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
  }, [betsOn]);

  useEffect(() => {
    if (!betsOn || me == null) return;
    let cancelled = false;
    const watched = me.preferences.watchedLeagueIds;
    const targets =
      watched.length === 0
        ? leagues
        : leagues.filter((league) => watched.includes(league.league_id));
    void fetchAllLineups(targets)
      .then((rows) => {
        if (cancelled) return;
        setWatchedLineups(rows);
        setWatchedLineupsFailed(false);
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
        if (cancelled) return;
        setWatchedStarterTotal(null);
        setWatchedLineupsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [betsOn, leagues, me]);

  useFocusEffect(
    useCallback(() => {
      if (!betsOn) return;
      const week = lineup?.week ?? nflWeek;
      if (week == null) return;
      void fetchWatchPicks(week)
        .then((response) => {
          setBets(response.stakes);
          setSpentSlots(response.free_slots_spent ?? 0);
          setStakesKnown(true);
        })
        .catch(() => {
          setBets([]);
          setStakesKnown(false);
        });
      void fetchGamesLive()
        .then((response) => setLiveGames(response.games))
        .catch(() => setLiveGames([]));
    }, [betsOn, lineup?.week, nflWeek]),
  );

  useEffect(() => {
    return subscribeAddPickSaved(() => {
      const week = lineup?.week ?? nflWeek;
      if (!betsOn || week == null) return;
      void fetchWatchPicks(week)
        .then((response) => {
          setBets(response.stakes);
          setSpentSlots(response.free_slots_spent ?? 0);
          setStakesKnown(true);
        })
        .catch(() => {
          setBets([]);
          setStakesKnown(false);
        });
    });
  }, [betsOn, lineup?.week, nflWeek]);

  const dropRemovedStake = (stake: ManualStake) => {
    setBets((current) => current.filter((row) => row.id !== stake.id));
    // Same rule as the API: a counted pick removed after kickoff keeps its slot spent.
    if (removalKeepsFreeSlot(stake, new Date())) {
      setSpentSlots((current) => current + freeBetCount([stake]));
    }
  };

  const dropRemovedStakeRef = useRef(dropRemovedStake);
  dropRemovedStakeRef.current = dropRemovedStake;

  const commitStakeRemoval = async (stake: ManualStake) => {
    await deleteWatchPick(stake);
    dropRemovedStake(stake);
  };

  // Phone removal (issue #14): a swipe hides the pick and shows Undo. The DELETE goes out when
  // the toast expires, another pick is removed, or the user leaves. Same store as desktop.
  const removal = useSyncExternalStore(subscribeStakeUndo, getStakeUndoState, getStakeUndoState);
  const betsRef = useRef(bets);
  betsRef.current = bets;
  useEffect(() => {
    bindStakeUndoCommit(async (id) => {
      const stake = betsRef.current.find((row) => row.id === id);
      if (!stake) return;
      // A parlay goes to DELETE /picks/slips/:id. Either way, a started pick keeps its slot.
      await deleteWatchPick(stake);
      dropRemovedStakeRef.current(stake);
    });
  }, []);
  useFocusEffect(
    useCallback(() => {
      // Leaving Watchlist (another tab, a pushed screen) commits the pending removal.
      return () => {
        flushStakeUndo();
      };
    }, []),
  );
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') flushStakeUndo();
    });
    return () => subscription.remove();
  }, []);

  const confirmRemoveBet = (stake: ManualStake) => {
    const label = watchPickLabel(stake);
    void confirmAsync({
      title: 'Remove this bet?',
      message: removePickMessage(stake, label, {
        isPro: me?.subscription_tier === 'pro',
        now: new Date(),
      }),
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      destructive: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      void (async () => {
        try {
          await deleteWatchPick(stake);
          dropRemovedStake(stake);
        } catch (error) {
          void alertAsync('Could not remove', errorMessage(error));
        }
      })();
    });
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
      void alertAsync('Refresh failed', errorMessage(error));
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
                void alertAsync('Could not rename', errorMessage(error));
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
      void alertAsync('Could not update star', errorMessage(error));
    } finally {
      setSavingSlotId(null);
    }
  };

  const browsedLeagueReady = lineup != null && lineup.league_id === selectedLeague?.league_id;
  const watchOpponent = watchOpponentPending ?? me?.preferences.watchOpponent ?? false;
  const opponentStatus = opponentStripStatus({
    browsedLeagueReady,
    platform: browsedLeagueReady ? (selectedLeague?.platform ?? null) : null,
    preferenceKnown: me != null,
    watchOpponent,
  });
  const opponentView = opponentSectionState(
    lineup?.opponent,
    opponentStatus === 'on',
    selectedLeague?.platform !== 'sleeper' && lineup?.opponent != null,
  );
  const split = splitBets(bets);
  // Live, then upcoming by kickoff, then finals (issue #14; same rule as Home's YOUR PICKS).
  const propBets = orderPicks(split.bets, weekGames, liveGames);
  const poolBets = orderPicks(split.pools, weekGames, liveGames);
  const notHidden = (stake: ManualStake) => !removal.hiddenIds.includes(stake.id);
  const sections = watchlistSections(filter);
  const showLeagueChips = !watchlist || sections.includes('leagueChips');
  const showRoster = !watchlist || sections.includes('starters');
  const showOpponent = !watchlist || sections.includes('opponent');
  const opponentTeamName =
    showOpponent && (opponentView === 'on' || opponentView === 'off')
      ? (lineup?.opponent?.team_name?.trim() ?? '')
      : '';
  const opponentNote = !showOpponent
    ? null
    : opponentView === 'empty'
      ? opponentEmptyCopy(lineup?.last_synced_at)
      : opponentView === 'off'
        ? "See your opponent's red-zone trips on Home. No notifications."
        : null;
  const showOpponentSection = showOpponent && opponentView !== 'hidden';
  const opponentPlayerSlots =
    opponentView === 'on' && lineup?.opponent
      ? lineup.opponent.starters.map(opponentStarterSlot).filter((slot) => !isBenchSlot(slot))
      : [];
  const showActions = watchlist && sections.includes('leagueActions');
  const showLeagueCards = watchlist && sections.includes('leagueCards');
  const liveTeams = liveTeamAbbrs(weekGames, liveGames);
  const leagueCards = showLeagueCards
    ? allTabLeagues(leagues, me?.preferences.watchedLeagueIds ?? knownWatchedRef.current ?? []).map(
        (league) => {
          const row = watchedLineups?.find((candidate) => candidate.league_id === league.league_id);
          const starters = row
            ? orderLineupSlots(row.slots).filter((slot) => !isBenchSlot(slot))
            : [];
          const model = fantasyLeagueCardModel({ league, slots: starters, liveTeams });
          const summary = row
            ? model.summary
            : watchedLineups == null && !watchedLineupsFailed
              ? 'Loading lineup…'
              : "Couldn't load this lineup.";
          return { league, starters, model: { ...model, summary } };
        },
      )
    : [];
  const seeFullLineup = (leagueId: string) => {
    selectFilter('fantasy');
    setSelectedLeagueId(watchlistLeagueSelection({ type: 'chip', leagueId }).selectedLeagueId);
  };
  const showPropBets = watchlist && sections.includes('bets');
  const showPools = watchlist && sections.includes('pools');
  const headerWeek = watchlist ? (lineup?.week ?? nflWeek) : (lineup?.week ?? null);
  const weekCard = weekCardModel({
    starterCount:
      browsedLeagueReady && weekGames != null ? browsedStarterCount(lineup.slots, weekGames) : null,
    opponentStatus,
    betCount: stakesKnown ? freeBetCount(bets, spentSlots) : null,
    survivorCount: stakesKnown ? poolBets.length : null,
    isPro: me?.subscription_tier === 'pro',
    week: headerWeek,
    gameCount:
      weekGames != null && stakesKnown
        ? cardGameCount(
            browsedLeagueReady
              ? starterSlots.map((slot) => slot.player.team?.abbreviation ?? null)
              : [],
            bets.flatMap(stakeGameIds),
            weekGames,
          )
        : null,
  });
  const betPrompt =
    filter === 'bets' && stakesKnown
      ? sparseBetPrompt({
          rowCount: propBets.length,
          betsUsed: freeBetCount(bets, spentSlots),
          isPro: me?.subscription_tier === 'pro',
        })
      : null;

  const onWatchOpponent = async (next: boolean) => {
    if (watchOpponentSave.current || next === watchOpponent) return;
    watchOpponentSave.current = true;
    setWatchOpponentPending(next);
    try {
      const updated = await patchPreferences({ watchOpponent: next });
      setMe(updated);
    } catch (error) {
      void alertAsync('Could not update', errorMessage(error));
    } finally {
      setWatchOpponentPending(null);
      watchOpponentSave.current = false;
    }
  };

  const onSelectLeague = (leagueId: string) => {
    const next = watchlistLeagueSelection({ type: 'chip', leagueId });
    setSelectedLeagueId(next.selectedLeagueId);
  };

  const onSetActive = () => {
    if (!selectedLeague || !me || settingActive) return;
    const decision = watchlistLeagueSelection({
      type: 'set-active',
      leagueId: selectedLeague.league_id,
      tier: me.subscription_tier === 'pro' ? 'pro' : 'free',
      watchedLeagueIds: me.preferences.watchedLeagueIds,
    });
    const patch = decision.preferencePatch;
    if (!patch) return;
    setSettingActive(true);
    void (async () => {
      try {
        const updated = await patchPreferences(patch);
        setMe(updated);
        setSelectedLeagueId(decision.selectedLeagueId);
      } catch (error) {
        void alertAsync('Could not save', errorMessage(error));
      } finally {
        setSettingActive(false);
      }
    })();
  };

  const chipCue =
    me == null
      ? { showsActiveTag: false, watchLabel: null }
      : watchlistChipCue({
          leagueId: selectedLeague?.league_id ?? null,
          tier: me.subscription_tier === 'pro' ? 'pro' : 'free',
          watchedLeagueIds: me.preferences.watchedLeagueIds,
        });
  const showsActiveTag = chipCue.showsActiveTag;
  const watchLabel = chipCue.watchLabel;
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
          void alertAsync('Sync failed', errorMessage(error));
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
      void confirmAsync({
        title: 'Disconnect league?',
        message: `Remove "${selectedLeague.name}" from Pivot?`,
        confirmLabel: 'Disconnect',
        cancelLabel: 'Cancel',
        destructive: true,
      }).then((confirmed) => {
        if (!confirmed) return;
        void (async () => {
          setBusyLeagueId(selectedLeague.league_id);
          try {
            await disconnectLeague(selectedLeague.league_id);
            const rows = await refreshLeagues();
            if (rows.length === 0) {
              deferConnect();
            }
          } catch (error) {
            void alertAsync('Could not disconnect', errorMessage(error));
          } finally {
            setBusyLeagueId(null);
          }
        })();
      });
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

  useEffect(() => {
    if (!lineup) return;
    const watchedLeagueIds =
      me != null
        ? me.preferences.watchedLeagueIds
        : (readRememberedWatchlist()?.watchedLeagueIds ?? knownWatchedRef.current);
    if (me != null) knownWatchedRef.current = me.preferences.watchedLeagueIds;
    rememberWatchlist({
      lineup,
      weekGames,
      bets,
      stakesKnown,
      me,
      nflWeek,
      watchedStarterTotal,
      watchedLeagueIds,
    });
  }, [bets, lineup, me, nflWeek, stakesKnown, watchedStarterTotal, weekGames]);

  const editsLocked = me?.is_demo === true;

  const coldLoading = watchlist && showFullLoading(lineup != null, isLoading) && !loadError;
  const placeholderVisible = useLoadingPlaceholder(coldLoading);
  const slowLoading = useSlowLoading(coldLoading);

  if (!watchlist && showFullLoading(lineup != null, isLoading)) {
    return (
      <View style={[styles.screen, styles.content, { paddingTop: insets.top + theme.spacing.lg }]}>
        <LineupHeader week={null} />
        <LoadingState message={lineupLoadingMessage(watchlist)} />
      </View>
    );
  }

  if (watchlist && (coldLoading || (placeholderVisible && !loadError))) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.huge,
            paddingHorizontal:
              watchlist && desktopTier !== 'companion' ? theme.spacing.xl : theme.spacing.lg2,
          },
        ]}
      >
        <WatchlistHeader week={nflWeek} />
        {placeholderVisible ? (
          <ColdLoading screen="watchlist" slow={slowLoading} onRetry={onRefresh} />
        ) : null}
      </ScrollView>
    );
  }

  if (watchlist && desktopTier !== 'companion') {
    const desktop = (
      <WatchlistDesktop
        benchSlots={showRoster ? benchSlots : []}
        bottomInset={insets.bottom + theme.spacing.huge}
        editsLocked={editsLocked}
        extras={
          <>
            {editsLocked ? <DemoEditingBanner /> : null}
            {showActions ? (
              <View style={styles.leagueActions}>
                <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
                  LEAGUE
                </Text>
                <View style={styles.leagueActionRow}>
                  <TextButton
                    disabled={editsLocked}
                    label="Connect"
                    onPress={() => {
                      router.push('/(app)/connect-team');
                    }}
                    size="smallStrong"
                  />
                  {selectedLeague?.platform === 'sleeper' ? (
                    <TextButton
                      disabled={manageBusy || editsLocked}
                      label="Sync"
                      onPress={() => runLeagueAction('Sync')}
                      size="smallStrong"
                    />
                  ) : null}
                  {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
                    <TextButton
                      disabled={manageBusy || editsLocked}
                      label="Edit lineup"
                      onPress={() => runLeagueAction('Edit lineup')}
                      size="smallStrong"
                    />
                  ) : null}
                  {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
                    <TextButton
                      disabled={manageBusy || editsLocked}
                      label="Rename"
                      onPress={() => runLeagueAction('Rename')}
                      size="smallStrong"
                    />
                  ) : null}
                  {selectedLeague ? (
                    <TextButton
                      disabled={manageBusy || editsLocked}
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
              <LeagueBrowse
                editsLocked={editsLocked}
                leagues={leagues}
                onSelect={onSelectLeague}
                onSetActive={onSetActive}
                selectedLeague={selectedLeague}
                settingActive={settingActive}
                showsActiveTag={showsActiveTag}
                watchLabel={watchLabel}
              />
            ) : null}
          </>
        }
        filter={filter}
        liveGames={liveGames}
        now={now}
        onAddStake={() => {
          if (editsLocked) return;
          openAddPick();
        }}
        onFilter={selectFilter}
        onRefresh={() => {
          void onRefresh();
        }}
        betPrompt={betPrompt}
        leagueCards={leagueCards.map(({ starters, model }) => ({ model, starters }))}
        isLeagueExpanded={leagueExpansion.isExpanded}
        onToggleLeague={leagueExpansion.toggle}
        onSeeFullLineup={seeFullLineup}
        onRemoveStake={(stake) => commitStakeRemoval(stake)}
        onWatchOpponent={(value) => {
          void onWatchOpponent(value);
        }}
        opponentNote={opponentNote}
        opponentSlots={showOpponent && opponentView === 'on' ? opponentPlayerSlots : []}
        opponentTeamName={opponentTeamName.length > 0 ? opponentTeamName : null}
        showOpponent={showOpponentSection}
        pools={showPools ? poolBets : []}
        refreshing={isRefreshing}
        stakes={showPropBets ? propBets : []}
        starterSlots={showRoster ? starterSlots : []}
        timeZone={timeZone}
        topInset={insets.top + theme.spacing.lg}
        week={headerWeek}
        weekCard={weekCard}
        weekGames={weekGames}
      />
    );
    return withFlash(desktop);
  }

  if (leagues.length === 0 && !watchlist) {
    return (
      <View
        style={[styles.screen, styles.emptyScreen, { paddingTop: insets.top + theme.spacing.lg }]}
      >
        <LineupHeader week={null} />
        {editsLocked ? <DemoEditingBanner /> : null}
        <Text style={styles.emptyCopy}>Connect a fantasy team to manage your lineup.</Text>
        <SecondaryButton
          disabled={editsLocked}
          label="Connect a team"
          onPress={() => router.push('/(app)/connect-team')}
        />
      </View>
    );
  }

  const phone = (
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
      {editsLocked ? <DemoEditingBanner /> : null}

      {watchlist ? (
        <>
          <WeekCard
            editsLocked={editsLocked}
            model={weekCard}
            onAddStake={() => {
              if (editsLocked) return;
              openAddPick();
            }}
            onOpponentToggle={() => {
              void onWatchOpponent(opponentStatus !== 'on');
            }}
            onShare={() => setShareContent(weekCardShareContent(weekCard))}
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
              disabled={editsLocked}
              label="Connect"
              onPress={() => {
                router.push('/(app)/connect-team');
              }}
              size="smallStrong"
            />
            {selectedLeague?.platform === 'sleeper' ? (
              <TextButton
                disabled={manageBusy || editsLocked}
                label="Sync"
                onPress={() => runLeagueAction('Sync')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
              <TextButton
                disabled={manageBusy || editsLocked}
                label="Edit lineup"
                onPress={() => runLeagueAction('Edit lineup')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague && selectedLeague.platform !== 'sleeper' ? (
              <TextButton
                disabled={manageBusy || editsLocked}
                label="Rename"
                onPress={() => runLeagueAction('Rename')}
                size="smallStrong"
              />
            ) : null}
            {selectedLeague ? (
              <TextButton
                disabled={manageBusy || editsLocked}
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
        <LeagueBrowse
          editsLocked={editsLocked}
          leagues={leagues}
          onSelect={onSelectLeague}
          onSetActive={onSetActive}
          selectedLeague={selectedLeague}
          settingActive={settingActive}
          showsActiveTag={showsActiveTag}
          watchLabel={watchLabel}
        />
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
        {leagueCards.map(({ league, starters, model }) => (
          <FantasyLeagueCard
            expanded={leagueExpansion.isExpanded(league.league_id)}
            key={league.league_id}
            model={model}
            onSeeFullLineup={() => seeFullLineup(league.league_id)}
            onToggle={() => leagueExpansion.toggle(league.league_id)}
          >
            {starters.length > 0 ? (
              <View style={styles.rosterWell}>
                {starters.map((slot, index) => (
                  <PlayerRow
                    divided={index > 0}
                    key={slot.slot_id}
                    mutedName={false}
                    now={now}
                    onToggleStar={() => undefined}
                    saving
                    slot={slot}
                    timeZone={timeZone}
                    weekGames={weekGames}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyCopy}>No players in this lineup yet.</Text>
            )}
          </FantasyLeagueCard>
        ))}
        {showRoster ? (
          <>
            <View style={styles.rosterHeader}>
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
                STARTERS
              </Text>
              {selectedLeague && !watchlist ? (
                <TextButton
                  disabled={manageBusy || editsLocked}
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
                        saving={savingSlotId === slot.slot_id || !lineup || editsLocked}
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
                          saving={savingSlotId === slot.slot_id || !lineup || editsLocked}
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

        {showOpponentSection && browsedLeagueReady ? (
          <View style={styles.opponentSection} testID="watchlist-opponent">
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
              OPPONENT
            </Text>
            {opponentTeamName.length > 0 ? (
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.opponentTeam}>
                {`vs. ${opponentTeamName}`}
              </Text>
            ) : null}
            {opponentView === 'on' ? (
              <View style={styles.rosterWell}>
                {opponentPlayerSlots.map((slot, index) => (
                  <PlayerRow
                    divided={index > 0}
                    key={slot.slot_id}
                    mutedName
                    now={now}
                    onToggleStar={() => undefined}
                    opponent
                    saving={false}
                    showTeamStripe={false}
                    slot={slot}
                    timeZone={timeZone}
                    weekGames={weekGames}
                  />
                ))}
              </View>
            ) : (
              <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.opponentHint}>
                {opponentNote}
              </Text>
            )}
          </View>
        ) : null}

        {showPropBets ? (
          <BetGroup
            empty="No bets this week."
            liveGames={liveGames}
            editsLocked={editsLocked}
            onAdd={
              betPrompt
                ? () => {
                    if (editsLocked) return;
                    openAddPick();
                  }
                : undefined
            }
            now={now}
            onRemove={(stake) => hideStake(stake.id)}
            prompt={betPrompt}
            stakes={propBets.filter(notHidden)}
            title="BETS"
            weekGames={weekGames}
          />
        ) : null}
        {showPools && (filter === 'pools' || poolBets.length > 0) ? (
          <BetGroup
            editsLocked={editsLocked}
            empty="No pools this week."
            liveGames={liveGames}
            now={now}
            onRemove={(stake) => hideStake(stake.id)}
            stakes={poolBets.filter(notHidden)}
            title="POOLS"
            weekGames={weekGames}
          />
        ) : null}

        {!watchlist && betsOn ? (
          <View style={styles.opponentSection}>
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
              BETS
            </Text>
            <TextButton
              disabled={editsLocked}
              label="Add a pick"
              onPress={() => {
                if (editsLocked) return;
                openAddPick();
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
                      {watchPickLabel(stake)}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={theme.fontScaleCaps.dense}
                      style={styles.playerMeta}
                    >
                      {stakeMeta(stake)}
                    </Text>
                  </View>
                  <TextButton
                    disabled={editsLocked}
                    label="Remove"
                    onPress={() => confirmRemoveBet(stake)}
                    tone="danger"
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
  return withFlash(phone);
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
  prompt,
  onAdd,
  now,
  editsLocked = false,
}: {
  title: string;
  empty: string;
  stakes: ManualStake[];
  liveGames: readonly LiveGame[];
  weekGames: ScheduleGame[] | null;
  now: Date;
  onRemove: (stake: ManualStake) => void;
  prompt?: string | null;
  onAdd?: () => void;
  editsLocked?: boolean;
}) {
  return (
    <View style={styles.opponentSection}>
      <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.benchEyebrow}>
        {title}
      </Text>
      {stakes.length === 0 && !prompt ? <Text style={styles.emptyCopy}>{empty}</Text> : null}
      {stakes.map((stake) => (
        <StakeEntry
          editsLocked={editsLocked}
          key={stake.id}
          liveGames={liveGames}
          now={now}
          onRemove={onRemove}
          stake={stake}
          weekGames={weekGames}
        />
      ))}
      {prompt && onAdd ? (
        <TextButton disabled={editsLocked} label={prompt} onPress={onAdd} size="smallStrong" />
      ) : null}
    </View>
  );
}

function StakeEntry({
  stake,
  liveGames,
  weekGames,
  now,
  onRemove,
  editsLocked = false,
}: {
  stake: ManualStake;
  liveGames: readonly LiveGame[];
  weekGames: ScheduleGame[] | null;
  now: Date;
  onRemove: (stake: ManualStake) => void;
  editsLocked?: boolean;
}) {
  const model = pickCardModel({ stake, teams: stakeTeams(stake), weekGames, liveGames, now });
  // Demo account: no swipe, matching the desktop table's hidden Remove.
  if (editsLocked) return <PickCard model={model} />;
  return (
    <SwipeToRemove
      accessibilityLabel={[
        model.eyebrow,
        model.pick,
        model.matchup,
        model.status,
        model.detail ?? '',
      ]
        .filter((part) => part.length > 0)
        .join(', ')}
      onRemove={() => onRemove(stake)}
      testID={`swipe-pick-${stake.id}`}
    >
      <PickCard model={model} />
    </SwipeToRemove>
  );
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

function LeagueBrowse({
  leagues,
  selectedLeague,
  showsActiveTag,
  watchLabel,
  onSelect,
  onSetActive,
  settingActive,
  editsLocked = false,
}: {
  leagues: LeagueSummary[];
  selectedLeague: LeagueSummary | null;
  showsActiveTag: boolean;
  watchLabel: 'Set as active' | 'Also watch' | null;
  onSelect: (leagueId: string) => void;
  onSetActive: () => void;
  settingActive: boolean;
  editsLocked?: boolean;
}) {
  return (
    <View style={styles.switcherBlock}>
      <View style={styles.switcherHead}>
        <View style={styles.switcherChips}>
          <LeagueSwitcher
            leagues={leagues}
            onSelect={onSelect}
            selectedLeagueId={selectedLeague?.league_id ?? null}
          />
        </View>
        {showsActiveTag ? (
          <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.activeTag}>
            ACTIVE
          </Text>
        ) : watchLabel != null ? (
          <TextButton
            disabled={settingActive || editsLocked}
            label={watchLabel}
            onPress={onSetActive}
            size="smallStrong"
          />
        ) : null}
      </View>
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
  opponent = false,
}: {
  slot: LineupSlot;
  divided: boolean;
  mutedName: boolean;
  saving: boolean;
  weekGames: ScheduleGame[] | null;
  now: Date;
  timeZone: string;
  onToggleStar: (value: boolean) => void;
  /** Opponent rows keep the column, skip the team-color stripe, and have no star control. */
  showTeamStripe?: boolean;
  opponent?: boolean;
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
            {opponent ? 'OPP' : slotLabel(slot.position_in_lineup)}
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
      {SHOW_STAR_TOGGLES && !opponent ? (
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
  flashHost: {
    flex: 1,
  },
  // Rendered to capture, never seen: off the visible area but still laid out (not `display:
  // none`), which `react-native-view-shot` needs to actually capture it.
  shareOffscreen: {
    left: -9999,
    position: 'absolute',
    top: -9999,
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
  opponentTeam: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.body.size,
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
  activeTag: {
    color: theme.colors.brass,
    fontFamily: fonts.monoBold,
    fontSize: theme.type.eyebrow.size,
    letterSpacing: theme.type.eyebrow.letterSpacing,
  },
  switcherBlock: {
    gap: theme.spacing.sm,
  },
  switcherChips: {
    flex: 1,
    minWidth: 0,
  },
  switcherHead: {
    alignItems: 'center',
    flexDirection: 'row',
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
});
