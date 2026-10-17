import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActiveLineupPicker } from '../../../components/ActiveLineupPicker';
import { AlsoFlaggedRow } from '../../../components/AlsoFlaggedRow';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import type { FeaturedBetChip } from '../../../components/FeaturedStakeCard';
import { HomeDashboard } from '../../../components/HomeDashboard';
import { HomeLiveIdleCard } from '../../../components/HomeLiveIdleCard';
import { HomeLiveView, LiveModeEyebrow } from '../../../components/HomeLiveView';
import { HomePregameView, type PregameHero } from '../../../components/HomePregameView';
import { IdleHomeCard } from '../../../components/IdleHomeCard';
import { LoadingState } from '../../../components/LoadingState';
import { NowActiveCard } from '../../../components/NowActiveCard';
import { useSwitching } from '../../../contexts/SwitchingContext';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import { ApiRequestError, apiClient } from '../../../lib/apiClient';
import {
  boardStakeRefs,
  buildBoardRows,
  flattenRows,
  isPregameBranch,
  nextKickoff,
  pickFeaturedGame,
  type LiveBetEntry,
  type StakeRef,
} from '../../../lib/board';
import type { FlagEventPayload } from '../../../lib/flagEventPayload';
import {
  localRouteOption,
  pickPreferredBroadcast,
  watchCta,
  type CurrentFlag,
  type FlagsCurrentResponse,
  type GameBroadcast,
  type GameBroadcastsResponse,
} from '../../../lib/gameDisplay';
import {
  applyFlagEventToHome,
  applyGameStateToHome,
  type HomeFlagSlice,
} from '../../../lib/homeFlagUpdates';
import {
  filterLiveStakeGames,
  groupLineupByGame,
  isLiveDisplayPhase,
  nextStakeKickoff,
  resolveHomeBranch,
  stakeTeamAbbreviations,
  upcomingStakeGameGroups,
  type HomeBranch,
  type LineupGameGroup,
} from '../../../lib/homeState';
import {
  buildPlayerTeamMap,
  fetchAllLineups,
  type LeagueSummary,
  type LineupResponse,
} from '../../../lib/leagues';
import { flaggedCardsOpacity, liveFeedBanner } from '../../../lib/liveFeed';
import { buildLiveBoard, countLiveGames } from '../../../lib/liveBoard';
import { fetchMe, type MeResponse } from '../../../lib/me';
import { betEventRequestsRefetch, readBetGameIds } from '../../../lib/homeBets';
import {
  adoptBetWatch,
  adoptOpponentGames,
  emptyOpponentRefresh,
  noteBetGameState,
  noteBetInPlay,
  noteOpponentGameState,
  noteOpponentRefetchSettled,
  noteOpponentRefetchStarted,
  placeHomeFlags,
  readOpponentFields,
  seedOpponentRedZone,
  type OpponentRefreshState,
} from '../../../lib/opponentHome';
import { fetchNflState, type NflStateResponse } from '../../../lib/nflState';
import {
  fetchGamesLive,
  fetchGamesWeek,
  type GameStateMessage,
  type LiveGame,
  type ScheduleGame,
} from '../../../lib/schedule';
import { fetchStakes } from '../../../lib/stakesClient';
import type { ManualStake } from '../../../lib/stakes';
import { resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../../../lib/teamDisplay';
import { theme } from '../../../lib/theme';
import { useHomeRealtime } from '../../../lib/useHomeRealtime';

interface HomeData {
  hasLeagues: boolean;
  leagueCount: number;
  nflState: NflStateResponse | null;
  branch: HomeBranch;
  playerTeamMap: PlayerTeamMap;
  lineups: LineupResponse[];
  flag: CurrentFlag | null;
  /** Home State 1 "Also flagged" row — every other flagged game, priority-sorted. */
  otherFlags: CurrentFlag[];
  broadcast: GameBroadcast | null;
  broadcasts: GameBroadcast[];
  liveGames: LiveGame[];
  liveStakeGames: LiveGame[];
  weekGames: ScheduleGame[];
  lineupGroups: LineupGameGroup[];
  upcomingGames: LineupGameGroup[];
  countdownMs: number;
  /** Latest `/flags/current` `live_feed_ok`. Absent until a flags response, and when nothing is live. */
  liveFeedOk: boolean | undefined;
}

const EMPTY_TEAM_MAP: PlayerTeamMap = new Map();

/** Silent Home re-fetch while States 1–4 are active. Flag WS only carries flag_event; live slate
 *  (`/games/live`, week statuses) would otherwise stay frozen at cold-start until pull-to-refresh. */
const HOME_LIVE_REFRESH_MS = 30_000;

/** Pre-game countdown tick. Drives display only — it never reloads Home or changes the branch. */
const PREGAME_TICK_MS = 1_000;

function toFlagSlice(data: HomeData): HomeFlagSlice {
  return {
    hasLeagues: data.hasLeagues,
    nflState: data.nflState,
    playerTeamMap: data.playerTeamMap,
    lineups: data.lineups,
    flag: data.flag,
    otherFlags: data.otherFlags,
    broadcast: data.broadcast,
    broadcasts: data.broadcasts,
    liveGames: data.liveGames,
    liveStakeGames: data.liveStakeGames,
    weekGames: data.weekGames,
    lineupGroups: data.lineupGroups,
    upcomingGames: data.upcomingGames,
    countdownMs: data.countdownMs,
    branch: data.branch,
  };
}

function heroBetChips(refs: readonly StakeRef[], gameId: string): FeaturedBetChip[] {
  const chips: FeaturedBetChip[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'bet' || ref.gameId !== gameId) continue;
    if (ref.stakeId === undefined || ref.label === undefined || ref.label.length === 0) continue;
    chips.push({ stakeId: ref.stakeId, label: ref.label, eyebrow: ref.eyebrow ?? 'BET' });
  }
  return chips;
}

function emptyHome(partial: Partial<HomeData> & Pick<HomeData, 'hasLeagues' | 'branch'>): HomeData {
  return {
    leagueCount: 0,
    nflState: null,
    playerTeamMap: EMPTY_TEAM_MAP,
    lineups: [],
    flag: null,
    otherFlags: [],
    broadcast: null,
    broadcasts: [],
    liveGames: [],
    liveStakeGames: [],
    weekGames: [],
    lineupGroups: [],
    upcomingGames: [],
    countdownMs: 0,
    liveFeedOk: undefined,
    ...partial,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { switchToGame } = useSwitching();
  const { status: leaguesStatus, leagues, leaguesRevision, refreshLeagues } = useLeaguesGate();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<HomeData | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [manualStakes, setManualStakes] = useState<ManualStake[]>([]);
  const [pregameNowMs, setPregameNowMs] = useState(() => Date.now());

  const opponentRefresh = useRef<OpponentRefreshState>(emptyOpponentRefresh());
  const opponentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opponentEpoch = useRef(0);

  const clearOpponentTimer = useCallback(() => {
    if (opponentTimer.current) {
      clearTimeout(opponentTimer.current);
      opponentTimer.current = null;
    }
  }, []);

  const resetOpponentWatch = useCallback(
    (
      gameIds: readonly string[],
      live: readonly {
        game_id: string;
        in_red_zone: boolean;
        score?: { home: number; away: number };
        quarter?: number;
      }[],
      betGameIds: readonly string[] = [],
    ) => {
      clearOpponentTimer();
      opponentEpoch.current += 1;
      opponentRefresh.current = seedOpponentRedZone(gameIds, live, betGameIds);
    },
    [clearOpponentTimer],
  );

  const applyBroadcasts = useCallback(async (gameId: string) => {
    try {
      const response = await apiClient.get<GameBroadcastsResponse>(`/games/${gameId}/broadcasts`);
      const broadcasts = response.broadcasts;
      const broadcast = pickPreferredBroadcast(broadcasts);
      setHomeData((prev) => {
        if (!prev || prev.flag?.game_id !== gameId) return prev;
        return { ...prev, broadcast, broadcasts };
      });
    } catch (error) {
      console.warn('[home] failed to load broadcasts', error);
    }
  }, []);

  const refetchOpponentFlags = useRef<() => Promise<void>>(async () => undefined);

  const armOpponentRefetch = useCallback(
    (dueAtMs: number | null) => {
      clearOpponentTimer();
      if (dueAtMs === null) return;
      const wait = Math.max(0, dueAtMs - Date.now());
      opponentTimer.current = setTimeout(() => {
        opponentTimer.current = null;
        void refetchOpponentFlags.current();
      }, wait);
    },
    [clearOpponentTimer],
  );

  const onFlagEvent = useCallback(
    (payload: FlagEventPayload) => {
      if (betEventRequestsRefetch(payload.event_type)) {
        const next = noteBetInPlay(opponentRefresh.current, Date.now());
        const dueChanged = next.dueAtMs !== opponentRefresh.current.dueAtMs;
        opponentRefresh.current = next;
        if (dueChanged) armOpponentRefetch(next.dueAtMs);
        return;
      }
      setHomeData((prev) => {
        if (!prev || !prev.nflState) return prev;
        const result = applyFlagEventToHome(toFlagSlice(prev), payload);
        if (result.needsBroadcastFetch && result.broadcastGameId) {
          void applyBroadcasts(result.broadcastGameId);
        }
        return { ...prev, ...result.slice };
      });
    },
    [applyBroadcasts, armOpponentRefetch],
  );

  useEffect(() => {
    refetchOpponentFlags.current = async () => {
      clearOpponentTimer();
      if (opponentRefresh.current.inFlight) return;
      const epoch = opponentEpoch.current;
      opponentRefresh.current = noteOpponentRefetchStarted(opponentRefresh.current);
      let primaryGameId: string | null = null;
      let previousGameId: string | null = null;
      try {
        const response = await apiClient.get<FlagsCurrentResponse>('/flags/current');
        if (epoch !== opponentEpoch.current) return;
        const fields = readOpponentFields(response);
        const betGameIds = readBetGameIds(response);
        setHomeData((prev) => {
          if (!prev || epoch !== opponentEpoch.current) return prev;
          previousGameId = prev.flag?.game_id ?? null;
          const placed = placeHomeFlags(response.flags, fields.opponentFlags, prev.liveGames);
          primaryGameId = placed.flag?.game_id ?? null;
          const branch = prev.nflState
            ? resolveHomeBranch({
                hasLeagues: prev.hasLeagues,
                displayPhase: prev.nflState.display_phase,
                hasFlags: placed.flag !== null,
                hasLiveStakeGames: prev.liveStakeGames.length > 0,
                nextStakeKickoff: nextStakeKickoff(
                  prev.weekGames,
                  stakeTeamAbbreviations(prev.playerTeamMap),
                  new Date(),
                ),
                now: new Date(),
              })
            : prev.branch;
          return {
            ...prev,
            flag: placed.flag,
            otherFlags: placed.otherFlags,
            branch,
            liveFeedOk: response.live_feed_ok,
          };
        });
        opponentRefresh.current = adoptBetWatch(
          adoptOpponentGames(opponentRefresh.current, fields.opponentGameIds, []),
          betGameIds,
          response.flags.flatMap((flag) =>
            betGameIds.includes(flag.game_id)
              ? [
                  {
                    gameId: flag.game_id,
                    home: flag.game.score.home,
                    away: flag.game.score.away,
                    quarter: flag.game.quarter,
                  },
                ]
              : [],
          ),
        );
        if (primaryGameId && primaryGameId !== previousGameId) {
          void applyBroadcasts(primaryGameId);
        }
      } catch (error) {
        console.warn('[home] opponent flags refetch failed', error);
      }
      if (epoch !== opponentEpoch.current) return;
      opponentRefresh.current = noteOpponentRefetchSettled(opponentRefresh.current, Date.now());
      armOpponentRefetch(opponentRefresh.current.dueAtMs);
    };
  }, [applyBroadcasts, armOpponentRefetch, clearOpponentTimer]);

  useEffect(() => clearOpponentTimer, [clearOpponentTimer]);

  /**
   * Bets are written on other screens. A failed fetch leaves Home as it is with no bets
   * rather than failing the rest of the slate.
   */
  const loadManualStakes = useCallback(async (week: number) => {
    try {
      const response = await fetchStakes(week);
      setManualStakes(response.stakes);
    } catch (error) {
      console.warn('[home] failed to load stakes', error);
      setManualStakes([]);
    }
  }, []);

  /**
   * Section 10 Home cold-start (Sprint 10 Phase 2). Order matters:
   * 1. leagues from LeaguesGateContext (single SoT) → State 5 short-circuit
   * 2. GET /state/nfl → display_phase branch (off/pre idle vs regular/post live machine)
   * 3. off/pre: skip /games and /flags/current entirely
   * 4. regular/post: flags + live + week schedule → States 1–4
   *
   * Re-runs when `leaguesRevision` changes (connect / disconnect) — does not re-fetch `/leagues`.
   */
  const loadHome = useCallback(
    async (leagueRows: LeagueSummary[]) => {
      setLoadError(null);
      try {
        if (leagueRows.length === 0) {
          setMe(null);
          setManualStakes([]);
          resetOpponentWatch([], []);
          setHomeData(
            emptyHome({
              hasLeagues: false,
              branch: { branch: 'no_leagues' },
            }),
          );
          return;
        }

        const meResponse = await fetchMe();
        setMe(meResponse);

        // FIRST calendar call — decides the display_phase branch before any games/flags fetch.
        const nflState = await fetchNflState();
        const idleBranch = resolveHomeBranch({
          hasLeagues: true,
          displayPhase: nflState.display_phase,
          hasFlags: false,
          hasLiveStakeGames: false,
          nextStakeKickoff: null,
          now: new Date(),
        });

        if (idleBranch.branch === 'season_idle') {
          setManualStakes([]);
          resetOpponentWatch([], []);
          setHomeData(
            emptyHome({
              hasLeagues: true,
              leagueCount: leagueRows.length,
              nflState,
              branch: idleBranch,
            }),
          );
          return;
        }

        const [allLineups, flagsResponse, liveResponse, weekResponse] = await Promise.all([
          fetchAllLineups(leagueRows),
          apiClient.get<FlagsCurrentResponse>('/flags/current'),
          fetchGamesLive(),
          fetchGamesWeek(nflState.week),
        ]);

        const watchedIds = new Set(meResponse.preferences.watchedLeagueIds ?? []);
        const lineups =
          watchedIds.size > 0
            ? allLineups.filter((row) => watchedIds.has(row.league_id))
            : allLineups;

        const playerTeamMap = buildPlayerTeamMap(lineups);
        const stakeTeams = stakeTeamAbbreviations(playerTeamMap);
        const opponentFields = readOpponentFields(flagsResponse);
        const { flag: topFlag, otherFlags } = placeHomeFlags(
          flagsResponse.flags,
          opponentFields.opponentFlags,
          liveResponse.games,
        );
        resetOpponentWatch(
          opponentFields.opponentGameIds,
          liveResponse.games,
          readBetGameIds(flagsResponse),
        );
        const liveStakeGames = filterLiveStakeGames(liveResponse.games, stakeTeams);
        const weekGames = weekResponse.games;
        const now = new Date();
        const kickoff = nextStakeKickoff(weekGames, stakeTeams, now);
        const branch = resolveHomeBranch({
          hasLeagues: true,
          displayPhase: nflState.display_phase,
          hasFlags: topFlag !== null,
          hasLiveStakeGames: liveStakeGames.length > 0,
          nextStakeKickoff: kickoff,
          now,
        });

        let broadcast: GameBroadcast | null = null;
        let broadcasts: GameBroadcast[] = [];
        if (topFlag) {
          try {
            const response = await apiClient.get<GameBroadcastsResponse>(
              `/games/${topFlag.game_id}/broadcasts`,
            );
            broadcasts = response.broadcasts;
            broadcast = pickPreferredBroadcast(broadcasts);
          } catch (error) {
            console.warn('[home] failed to load broadcasts', error);
          }
        }

        const upcomingGames = upcomingStakeGameGroups(weekGames, lineups, stakeTeams, now);
        const lineupGroups = groupLineupByGame(weekGames, lineups, stakeTeams);
        const countdownMs = kickoff ? Math.max(0, kickoff.getTime() - now.getTime()) : 0;

        setHomeData({
          hasLeagues: true,
          leagueCount: leagueRows.length,
          nflState,
          branch,
          playerTeamMap,
          lineups,
          flag: topFlag,
          otherFlags,
          broadcast,
          broadcasts,
          liveGames: liveResponse.games,
          liveStakeGames,
          weekGames,
          lineupGroups,
          upcomingGames,
          countdownMs,
          liveFeedOk: flagsResponse.live_feed_ok,
        });
        void loadManualStakes(nflState.week);
      } catch (error) {
        const message =
          error instanceof ApiRequestError ? error.message : 'Could not load your games.';
        setLoadError(message);
      }
    },
    [loadManualStakes, resetOpponentWatch],
  );

  const onGameState = useCallback(
    (game: GameStateMessage) => {
      setHomeData((prev) => {
        if (!prev) return prev;
        return { ...prev, ...applyGameStateToHome(toFlagSlice(prev), game) };
      });
      const nowMs = Date.now();
      const afterOpponent = noteOpponentGameState(opponentRefresh.current, {
        gameId: game.game_id,
        inRedZone: game.in_red_zone,
        nowMs,
      });
      const next = noteBetGameState(afterOpponent, {
        gameId: game.game_id,
        home: game.score.home,
        away: game.score.away,
        quarter: game.quarter,
        nowMs,
      });
      const dueChanged = next.dueAtMs !== opponentRefresh.current.dueAtMs;
      opponentRefresh.current = next;
      if (dueChanged) armOpponentRefetch(next.dueAtMs);
    },
    [armOpponentRefetch],
  );

  // Every game on the slate, not just stake games: the live board shows each one's clock and score.
  const weekGameIds = useMemo(
    () => (homeData?.weekGames ?? []).map((game) => game.game_id),
    [homeData?.weekGames],
  );

  const onReconcileHome = useCallback(async () => {
    try {
      // Full Home reload — not flags-only. Foreground / WS reconnect must pick up games that
      // flipped to live while the socket was down; `/flags/current` alone cannot enter State 2.
      await loadHome(leagues);
    } catch (error) {
      console.warn('[home] reconcile failed', error);
    }
  }, [loadHome, leagues]);

  useHomeRealtime({
    displayPhase: homeData?.nflState?.display_phase ?? null,
    hasLeagues: homeData?.hasLeagues ?? false,
    homeReady: !isLoading && homeData !== null && loadError === null,
    onFlagEvent,
    onGameState,
    gameIds: weekGameIds,
    onReconcile: onReconcileHome,
  });

  const displayPhase = homeData?.nflState?.display_phase ?? null;

  useEffect(() => {
    if (leaguesStatus !== 'ready') return;
    if (displayPhase === null || !isLiveDisplayPhase(displayPhase)) return;
    const id = setInterval(() => {
      void loadHome(leagues);
    }, HOME_LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [leaguesStatus, displayPhase, leagues, loadHome]);

  useEffect(() => {
    if (leaguesStatus !== 'ready') {
      return;
    }
    let active = true;
    setIsLoading(true);
    void loadHome(leagues).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
    // leaguesRevision is the intentional invalidation signal when the shared list changes.
  }, [leaguesStatus, leaguesRevision, leagues, loadHome]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const rows = await refreshLeagues();
      await loadHome(rows);
    } catch {
      // refreshLeagues sets gate error; loadHome may also set loadError
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshLeagues, loadHome]);

  const onSwitch = useCallback(
    (broadcast: GameBroadcast) => {
      if (!homeData?.flag) return;
      const { flag } = homeData;
      const flaggedTeam = resolveFlaggedTeamDisplay(
        flag.game,
        flag.flagged_players,
        homeData.playerTeamMap,
      );
      switchToGame({
        gameId: flag.game_id,
        deepLinkUrl: broadcast.deep_link_url,
        label: `${flag.game.away_team} @ ${flag.game.home_team}`,
        awayNickname: flag.game.away_team_name,
        homeNickname: flag.game.home_team_name,
        teamName: flaggedTeam?.name,
        teamColors: flaggedTeam
          ? { primary: flaggedTeam.primaryColor, secondary: flaggedTeam.secondaryColor }
          : null,
        broadcasts: homeData.broadcasts,
      });
    },
    [homeData, switchToGame],
  );

  /**
   * "Also flagged" row Switch button — resolves that game's broadcast on demand and switches
   * playback to it directly. Deliberately does not touch `homeData.flag`/`broadcast(s)`: tapping
   * Switch here does not promote that game to the Home State 1 primary (see report).
   */
  const onSwitchOther = useCallback(
    async (flag: CurrentFlag) => {
      // The week slate often already has the https URL. Open it in this click, before the fetch.
      if (Platform.OS === 'web') {
        const game = homeData?.weekGames.find((row) => row.game_id === flag.game_id);
        const cta = game ? watchCta(game.broadcasts, game.airings) : null;
        if (cta?.kind === 'watch') {
          const flaggedTeam = resolveFlaggedTeamDisplay(
            flag.game,
            flag.flagged_players,
            homeData?.playerTeamMap ?? EMPTY_TEAM_MAP,
          );
          switchToGame({
            gameId: flag.game_id,
            deepLinkUrl: cta.broadcast.deep_link_url,
            label: `${flag.game.away_team} @ ${flag.game.home_team}`,
            awayNickname: flag.game.away_team_name,
            homeNickname: flag.game.home_team_name,
            teamName: flaggedTeam?.name,
            teamColors: flaggedTeam
              ? { primary: flaggedTeam.primaryColor, secondary: flaggedTeam.secondaryColor }
              : null,
            broadcasts: game?.broadcasts,
          });
          return;
        }
      }

      let broadcasts: GameBroadcast[] = [];
      try {
        const response = await apiClient.get<GameBroadcastsResponse>(
          `/games/${flag.game_id}/broadcasts`,
        );
        broadcasts = response.broadcasts;
      } catch (error) {
        console.warn('[home] failed to load broadcasts for also-flagged switch', error);
      }
      const broadcast = pickPreferredBroadcast(broadcasts);
      const flaggedTeam = resolveFlaggedTeamDisplay(
        flag.game,
        flag.flagged_players,
        homeData?.playerTeamMap ?? EMPTY_TEAM_MAP,
      );
      switchToGame({
        gameId: flag.game_id,
        deepLinkUrl: broadcast?.deep_link_url ?? null,
        label: `${flag.game.away_team} @ ${flag.game.home_team}`,
        awayNickname: flag.game.away_team_name,
        homeNickname: flag.game.home_team_name,
        teamName: flaggedTeam?.name,
        teamColors: flaggedTeam
          ? { primary: flaggedTeam.primaryColor, secondary: flaggedTeam.secondaryColor }
          : null,
        broadcasts,
      });
    },
    [homeData, switchToGame],
  );

  const isPregame = isPregameBranch(homeData?.branch.branch ?? null);

  const weekGameById = useMemo(
    () => new Map((homeData?.weekGames ?? []).map((game) => [game.game_id, game])),
    [homeData?.weekGames],
  );

  /** Also-flagged tiles read the week slate; a game missing from it keeps the on-tap Switch. */
  const alsoFlaggedCta = useCallback(
    (flag: CurrentFlag) => {
      const game = weekGameById.get(flag.game_id);
      return game ? watchCta(game.broadcasts, game.airings) : null;
    },
    [weekGameById],
  );

  /**
   * Countdown tick, focused-only. `useFocusEffect` tears the interval down on blur, so Home
   * isn't re-rendering once a second behind another tab. Only `pregameNowMs` changes here —
   * `loadHome` and the branch are untouched, and still move only on the 30s reload or a
   * WebSocket reconcile.
   */
  useFocusEffect(
    useCallback(() => {
      if (!isPregame) return;
      setPregameNowMs(Date.now());
      const id = setInterval(() => setPregameNowMs(Date.now()), PREGAME_TICK_MS);
      return () => clearInterval(id);
    }, [isPregame]),
  );

  const stakesWeek = homeData?.nflState?.week ?? null;
  const stakesBranch = homeData?.branch.branch ?? null;
  useFocusEffect(
    useCallback(() => {
      if (stakesWeek === null) return;
      if (stakesBranch === 'no_leagues' || stakesBranch === 'season_idle') return;
      void loadManualStakes(stakesWeek);
    }, [loadManualStakes, stakesBranch, stakesWeek]),
  );

  const liveBets = useMemo<LiveBetEntry[]>(() => {
    const flags = [homeData?.flag, ...(homeData?.otherFlags ?? [])].filter(
      (flag): flag is CurrentFlag => flag != null,
    );
    return flags.flatMap((flag) =>
      (flag.bets ?? []).map((bet) => ({
        stake_id: bet.stake_id,
        gameId: flag.game_id,
        label: bet.label,
      })),
    );
  }, [homeData?.flag, homeData?.otherFlags]);

  const fantasyRefs = useMemo<StakeRef[]>(
    () =>
      (homeData?.lineupGroups ?? []).flatMap((group) =>
        group.players.map((player) => ({
          gameId: group.game.game_id,
          teamId: player.team_abbreviation,
        })),
      ),
    [homeData?.lineupGroups],
  );

  const stakeRefs = useMemo(
    () =>
      boardStakeRefs({
        fantasyRefs,
        stakes: manualStakes,
        weekGames: homeData?.weekGames ?? [],
        liveBets,
      }),
    [fantasyRefs, homeData?.weekGames, liveBets, manualStakes],
  );

  const betRefs = useMemo(() => stakeRefs.filter((ref) => ref.kind === 'bet'), [stakeRefs]);

  // Derived in render rather than in `loadHome`: the board is a pure function of the week's
  // schedule plus the lineups that callback already fetches.
  const boardGroups = useMemo(
    () => buildBoardRows(homeData?.weekGames ?? [], stakeRefs),
    [homeData?.weekGames, stakeRefs],
  );

  const branchKey = homeData?.branch.branch ?? null;
  const isLive = branchKey === 'state1' || branchKey === 'state2';

  const liveBoardSections = useMemo(() => {
    if (!homeData || !isLive) return [];
    const heroGameIds =
      branchKey === 'state1'
        ? homeData.flag
          ? [homeData.flag.game_id]
          : []
        : homeData.liveStakeGames.map((game) => game.game_id);
    return buildLiveBoard({
      weekGames: homeData.weekGames,
      liveGames: homeData.liveGames,
      flaggedGameIds: homeData.otherFlags.map((flag) => flag.game_id),
      heroGameIds,
      stakeRefs,
    });
  }, [homeData, isLive, branchKey, stakeRefs]);

  const { hero: pregameHero, countdownMs: pregameCountdownMs, nextKickoffAt } = useMemo(() => {
    const rows = flattenRows(boardGroups);
    const now = new Date(pregameNowMs);
    const next = nextKickoff(rows, now);
    const featured = pickFeaturedGame(rows, now);
    const target = featured ?? next;
    const countdownMs = next ? Math.max(0, next.kickoff.getTime() - pregameNowMs) : null;
    const nextKickoffAt = next?.kickoff ?? null;

    if (!target) return { hero: null, countdownMs, nextKickoffAt };

    const game = homeData?.weekGames.find((row) => row.game_id === target.gameId) ?? null;
    if (!game) return { hero: null, countdownMs, nextKickoffAt };

    // Falling back to `nextKickoff` means the user has nothing riding on this game, so it gets
    // the NEXT KICKOFF eyebrow and no player chips.
    const hero: PregameHero =
      featured === null
        ? { game, players: [], eyebrow: 'NEXT KICKOFF' }
        : {
            game,
            players:
              homeData?.lineupGroups.find((group) => group.game.game_id === target.gameId)
                ?.players ?? [],
            bets: heroBetChips(stakeRefs, target.gameId),
          };
    return { hero, countdownMs, nextKickoffAt };
  }, [boardGroups, pregameNowMs, homeData?.weekGames, homeData?.lineupGroups, stakeRefs]);

  function renderBody() {
    if (!homeData) return null;

    switch (homeData.branch.branch) {
      case 'no_leagues':
        return (
          <EmptyState
            title="Connect your fantasy team to get started"
            message="We'll watch every game your players are in and tell you the moment to switch over."
            primaryAction={{
              label: 'Connect Sleeper',
              onPress: () => router.push('/(app)/connect-team?provider=sleeper&onboarding=1'),
            }}
            secondaryAction={{
              label: 'Add manually',
              onPress: () => router.push('/(app)/connect-team?provider=manual&onboarding=1'),
            }}
          />
        );
      case 'season_idle':
        return (
          <IdleHomeCard
            variant={homeData.branch.variant}
            season={homeData.nflState?.season ?? ''}
            leagueCount={homeData.leagueCount}
            preseasonStart={homeData.nflState?.preseason_start ?? null}
            regularSeasonStart={homeData.nflState?.regular_season_start ?? null}
          />
        );
      // One element for both live branches, so a flag firing or clearing doesn't remount it.
      case 'state1':
      case 'state2':
        return (
          <HomeLiveView
            hero={
              homeData.branch.branch === 'state1' ? (
                homeData.flag ? (
                  <View style={[styles.state1, { opacity: flaggedCardsOpacity(homeData.liveFeedOk) }]}>
                    <View style={styles.flareHero}>
                      <NowActiveCard
                        flag={homeData.flag}
                        cta={watchCta(
                          homeData.broadcasts,
                          weekGameById.get(homeData.flag.game_id)?.airings ?? [],
                        )}
                        localRoute={localRouteOption(homeData.broadcasts)}
                        playerTeamMap={homeData.playerTeamMap}
                        onSwitch={onSwitch}
                      />
                    </View>
                    <AlsoFlaggedRow
                      flags={homeData.otherFlags}
                      onSwitch={onSwitchOther}
                      ctaFor={alsoFlaggedCta}
                    />
                  </View>
                ) : null
              ) : (
                <HomeLiveIdleCard liveGames={homeData.liveStakeGames} />
              )
            }
            sections={liveBoardSections}
            betRefs={betRefs}
            groups={boardGroups}
            lineupGroups={homeData.lineupGroups}
            liveGames={homeData.liveGames}
          />
        );
      // One pre-game presentation for both branches (PIVOT-STAKES-PLAN.md §11.3). The branches
      // stay distinct in `resolveHomeBranch` because they still differ in whether a kickoff is
      // close enough to arm the live machine.
      case 'state3':
      case 'state4':
        return (
          <HomePregameView
            countdownMs={pregameCountdownMs}
            nextKickoffAt={nextKickoffAt}
            nowMs={pregameNowMs}
            betRefs={betRefs}
            groups={boardGroups}
            hero={pregameHero}
            lineupGroups={homeData.lineupGroups}
            week={homeData.nflState?.week ?? 0}
          />
        );
    }
  }

  const handleMeUpdated = useCallback(
    (updated: MeResponse) => {
      setMe(updated);
      void loadHome(leagues);
    },
    [loadHome, leagues],
  );

  const headerRight =
    me && leagues.length > 0 ? (
      <ActiveLineupPicker leagues={leagues} me={me} onMeUpdated={handleMeUpdated} />
    ) : undefined;

  const pausedBanner = !isLoading && !loadError ? liveFeedBanner(homeData?.liveFeedOk) : null;

  return (
    <HomeDashboard
      contentTopInset={insets.top + theme.spacing.lg}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      headerRight={headerRight}
      eyebrow={
        homeData && isLive && !isLoading && !loadError ? (
          <LiveModeEyebrow liveCount={countLiveGames(homeData.weekGames, homeData.liveGames)} />
        ) : undefined
      }
    >
      {isLoading ? (
        <LoadingState message="Loading…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={onRefresh} />
      ) : (
        <View style={styles.state1}>
          {pausedBanner ? (
            <Text maxFontSizeMultiplier={theme.fontScaleCaps.dense} style={styles.liveFeedBanner}>
              {pausedBanner}
            </Text>
          ) : null}
          {renderBody()}
        </View>
      )}
    </HomeDashboard>
  );
}

const styles = StyleSheet.create({
  flareHero: {
    borderRadius: theme.radii.hero,
    ...theme.effects.flareGlow,
  },
  liveFeedBanner: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  state1: {
    gap: theme.spacing.lg,
  },
});
