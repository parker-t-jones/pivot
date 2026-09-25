import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActiveLineupPicker } from '../../../components/ActiveLineupPicker';
import { AlsoFlaggedRow } from '../../../components/AlsoFlaggedRow';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { HomeDashboard } from '../../../components/HomeDashboard';
import { HomeLiveIdleCard } from '../../../components/HomeLiveIdleCard';
import {
  HomePregameView,
  type PregameHero,
} from '../../../components/HomePregameView';
import { IdleHomeCard } from '../../../components/IdleHomeCard';
import { LoadingState } from '../../../components/LoadingState';
import { NowActiveCard } from '../../../components/NowActiveCard';
import { useSwitching } from '../../../contexts/SwitchingContext';
import { useLeaguesGate } from '../../../contexts/LeaguesGateContext';
import { ApiRequestError, apiClient } from '../../../lib/apiClient';
import {
  buildBoardRows,
  flattenRows,
  isPregameBranch,
  nextKickoff,
  pickFeaturedGame,
  type StakeRef,
} from '../../../lib/board';
import type { FlagEventPayload } from '../../../lib/flagEventPayload';
import {
  pickPreferredBroadcast,
  type CurrentFlag,
  type FlagsCurrentResponse,
  type GameBroadcast,
  type GameBroadcastsResponse,
} from '../../../lib/gameDisplay';
import {
  applyFlagEventToHome,
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
import { fetchMe, type MeResponse } from '../../../lib/me';
import { fetchNflState, type NflStateResponse } from '../../../lib/nflState';
import {
  fetchGamesLive,
  fetchGamesWeek,
  type LiveGame,
  type ScheduleGame,
} from '../../../lib/schedule';
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
  liveStakeGames: LiveGame[];
  weekGames: ScheduleGame[];
  lineupGroups: LineupGameGroup[];
  upcomingGames: LineupGameGroup[];
  countdownMs: number;
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
    liveStakeGames: data.liveStakeGames,
    weekGames: data.weekGames,
    lineupGroups: data.lineupGroups,
    upcomingGames: data.upcomingGames,
    countdownMs: data.countdownMs,
    branch: data.branch,
  };
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
    liveStakeGames: [],
    weekGames: [],
    lineupGroups: [],
    upcomingGames: [],
    countdownMs: 0,
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
  const [pregameNowMs, setPregameNowMs] = useState(() => Date.now());

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

  const onFlagEvent = useCallback(
    (payload: FlagEventPayload) => {
      setHomeData((prev) => {
        if (!prev || !prev.nflState) return prev;
        const result = applyFlagEventToHome(toFlagSlice(prev), payload);
        if (result.needsBroadcastFetch && result.broadcastGameId) {
          void applyBroadcasts(result.broadcastGameId);
        }
        return { ...prev, ...result.slice };
      });
    },
    [applyBroadcasts],
  );

  /**
   * Section 10 Home cold-start (Sprint 10 Phase 2). Order matters:
   * 1. leagues from LeaguesGateContext (single SoT) → State 5 short-circuit
   * 2. GET /state/nfl → display_phase branch (off/pre idle vs regular/post live machine)
   * 3. off/pre: skip /games and /flags/current entirely
   * 4. regular/post: flags + live + week schedule → States 1–4
   *
   * Re-runs when `leaguesRevision` changes (connect / disconnect) — does not re-fetch `/leagues`.
   */
  const loadHome = useCallback(async (leagueRows: LeagueSummary[]) => {
    setLoadError(null);
    try {
      if (leagueRows.length === 0) {
        setMe(null);
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
      const topFlag = flagsResponse.flags[0] ?? null;
      const otherFlags = flagsResponse.flags.slice(1);
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
        liveStakeGames,
        weekGames,
        lineupGroups,
        upcomingGames,
        countdownMs,
      });
    } catch (error) {
      const message =
        error instanceof ApiRequestError ? error.message : 'Could not load your games.';
      setLoadError(message);
    }
  }, []);

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

  const onSwitch = useCallback(() => {
    if (!homeData?.flag) return;
    const { flag, broadcast } = homeData;
    const flaggedTeam = resolveFlaggedTeamDisplay(
      flag.game,
      flag.flagged_players,
      homeData.playerTeamMap,
    );
    switchToGame({
      gameId: flag.game_id,
      deepLinkUrl: broadcast?.deep_link_url ?? null,
      label: `${flag.game.away_team} @ ${flag.game.home_team}`,
      teamName: flaggedTeam?.name,
      teamColors: flaggedTeam
        ? { primary: flaggedTeam.primaryColor, secondary: flaggedTeam.secondaryColor }
        : null,
      broadcasts: homeData.broadcasts,
    });
  }, [homeData, switchToGame]);

  /**
   * "Also flagged" row Switch button — resolves that game's broadcast on demand and switches
   * playback to it directly. Deliberately does not touch `homeData.flag`/`broadcast(s)`: tapping
   * Switch here does not promote that game to the Home State 1 primary (see report).
   */
  const onSwitchOther = useCallback(
    async (flag: CurrentFlag) => {
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

  /** One ref per active starter, so `buildBoardRows` can take real stakes after stakes Phase 1. */
  const stakeRefs = useMemo<StakeRef[]>(
    () =>
      (homeData?.lineupGroups ?? []).flatMap((group) =>
        group.players.map((player) => ({
          gameId: group.game.game_id,
          teamId: player.team_abbreviation,
        })),
      ),
    [homeData?.lineupGroups],
  );

  // Derived in render rather than in `loadHome`: the board is a pure function of the week's
  // schedule plus the lineups that callback already fetches.
  const boardGroups = useMemo(
    () => buildBoardRows(homeData?.weekGames ?? [], stakeRefs),
    [homeData?.weekGames, stakeRefs],
  );

  const { hero: pregameHero, countdownMs: pregameCountdownMs } = useMemo(() => {
    const rows = flattenRows(boardGroups);
    const now = new Date(pregameNowMs);
    const next = nextKickoff(rows, now);
    const featured = pickFeaturedGame(rows, now);
    const target = featured ?? next;
    const countdownMs = next ? Math.max(0, next.kickoff.getTime() - pregameNowMs) : null;

    if (!target) return { hero: null, countdownMs };

    const game = homeData?.weekGames.find((row) => row.game_id === target.gameId) ?? null;
    if (!game) return { hero: null, countdownMs };

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
          };
    return { hero, countdownMs };
  }, [boardGroups, pregameNowMs, homeData?.weekGames, homeData?.lineupGroups]);

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
      case 'state1':
        return homeData.flag ? (
          <View style={styles.state1}>
            <NowActiveCard
              flag={homeData.flag}
              broadcast={homeData.broadcast}
              playerTeamMap={homeData.playerTeamMap}
              onSwitch={onSwitch}
            />
            <AlsoFlaggedRow flags={homeData.otherFlags} onSwitch={onSwitchOther} />
          </View>
        ) : null;
      case 'state2':
        return <HomeLiveIdleCard liveGames={homeData.liveStakeGames} />;
      // One pre-game presentation for both branches (PIVOT-STAKES-PLAN.md §11.3). The branches
      // stay distinct in `resolveHomeBranch` because they still differ in whether a kickoff is
      // close enough to arm the live machine.
      case 'state3':
      case 'state4':
        return (
          <HomePregameView
            countdownMs={pregameCountdownMs}
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

  return (
    <HomeDashboard
      contentTopInset={insets.top + theme.spacing.lg}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      headerRight={headerRight}
    >
      {isLoading ? (
        <LoadingState message="Loading…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={onRefresh} />
      ) : (
        renderBody()
      )}
    </HomeDashboard>
  );
}

const styles = StyleSheet.create({
  state1: {
    gap: theme.spacing.lg,
  },
});
