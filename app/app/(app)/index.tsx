import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { HomeLiveIdleCard } from '../../components/HomeLiveIdleCard';
import { HomeOffDayCard } from '../../components/HomeOffDayCard';
import { HomePregameCard } from '../../components/HomePregameCard';
import { IdleHomeCard } from '../../components/IdleHomeCard';
import { LoadingState } from '../../components/LoadingState';
import { NowActiveCard } from '../../components/NowActiveCard';
import { useSwitching } from '../../contexts/SwitchingContext';
import { ApiRequestError, apiClient } from '../../lib/apiClient';
import {
  pickPreferredBroadcast,
  type CurrentFlag,
  type FlagsCurrentResponse,
  type GameBroadcast,
  type GameBroadcastsResponse,
} from '../../lib/gameDisplay';
import {
  countStakePlayersInGame,
  filterLiveStakeGames,
  findNextStakeGame,
  groupLineupByGame,
  nextStakeKickoff,
  resolveHomeBranch,
  stakeTeamAbbreviations,
  type HomeBranch,
  type LineupGameGroup,
} from '../../lib/homeState';
import {
  buildPlayerTeamMap,
  fetchAllLineups,
  fetchLeagues,
  type LeagueSummary,
  type LineupResponse,
} from '../../lib/leagues';
import { fetchNflState, type NflStateResponse } from '../../lib/nflState';
import { fetchGamesLive, fetchGamesWeek, type LiveGame, type ScheduleGame } from '../../lib/schedule';
import { resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../../lib/teamDisplay';
import { theme } from '../../lib/theme';

interface HomeData {
  hasLeagues: boolean;
  leagueCount: number;
  nflState: NflStateResponse | null;
  branch: HomeBranch;
  playerTeamMap: PlayerTeamMap;
  lineups: LineupResponse[];
  flag: CurrentFlag | null;
  broadcast: GameBroadcast | null;
  broadcasts: GameBroadcast[];
  liveStakeGames: LiveGame[];
  weekGames: ScheduleGame[];
  lineupGroups: LineupGameGroup[];
  nextGame: ScheduleGame | null;
  nextGamePlayerCount: number;
  countdownMs: number;
}

const EMPTY_TEAM_MAP: PlayerTeamMap = new Map();

function emptyHome(partial: Partial<HomeData> & Pick<HomeData, 'hasLeagues' | 'branch'>): HomeData {
  return {
    leagueCount: 0,
    nflState: null,
    playerTeamMap: EMPTY_TEAM_MAP,
    lineups: [],
    flag: null,
    broadcast: null,
    broadcasts: [],
    liveStakeGames: [],
    weekGames: [],
    lineupGroups: [],
    nextGame: null,
    nextGamePlayerCount: 0,
    countdownMs: 0,
    ...partial,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { switchToGame } = useSwitching();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<HomeData | null>(null);

  /**
   * Section 10 Home cold-start (Sprint 10 Phase 2). Order matters:
   * 1. leagues → State 5 short-circuit
   * 2. GET /state/nfl → display_phase branch (off/pre idle vs regular/post live machine)
   * 3. off/pre: skip /games and /flags/current entirely
   * 4. regular/post: flags + live + week schedule → States 1–4
   *
   * Phase 3 seam: a WebSocket `flag_event` subscription will update State 1/2 in place; this path
   * stays the initial/refresh read only — do not build the WS client here.
   */
  const loadHome = useCallback(async () => {
    setLoadError(null);
    try {
      const leagues: LeagueSummary[] = await fetchLeagues();
      if (leagues.length === 0) {
        setHomeData(
          emptyHome({
            hasLeagues: false,
            branch: { branch: 'no_leagues' },
          }),
        );
        return;
      }

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
            leagueCount: leagues.length,
            nflState,
            branch: idleBranch,
          }),
        );
        return;
      }

      const [lineups, flagsResponse, liveResponse, weekResponse] = await Promise.all([
        fetchAllLineups(leagues),
        apiClient.get<FlagsCurrentResponse>('/flags/current'),
        fetchGamesLive(),
        fetchGamesWeek(nflState.week),
      ]);

      const playerTeamMap = buildPlayerTeamMap(lineups);
      const stakeTeams = stakeTeamAbbreviations(playerTeamMap);
      const topFlag = flagsResponse.flags[0] ?? null;
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

      const nextGame = findNextStakeGame(weekGames, stakeTeams, now);
      const nextGamePlayerCount = nextGame
        ? countStakePlayersInGame(lineups, nextGame.home_team, nextGame.away_team)
        : 0;
      const lineupGroups = groupLineupByGame(weekGames, lineups, stakeTeams);
      const countdownMs = kickoff ? Math.max(0, kickoff.getTime() - now.getTime()) : 0;

      setHomeData({
        hasLeagues: true,
        leagueCount: leagues.length,
        nflState,
        branch,
        playerTeamMap,
        lineups,
        flag: topFlag,
        broadcast,
        broadcasts,
        liveStakeGames,
        weekGames,
        lineupGroups,
        nextGame,
        nextGamePlayerCount,
        countdownMs,
      });
    } catch (error) {
      const message =
        error instanceof ApiRequestError ? error.message : 'Could not load your games.';
      setLoadError(message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void loadHome().finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadHome]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadHome();
    setIsRefreshing(false);
  }, [loadHome]);

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
          <NowActiveCard
            flag={homeData.flag}
            broadcast={homeData.broadcast}
            playerTeamMap={homeData.playerTeamMap}
            onSwitch={onSwitch}
          />
        ) : null;
      case 'state2':
        return <HomeLiveIdleCard liveGames={homeData.liveStakeGames} />;
      case 'state3':
        return (
          <HomePregameCard countdownMs={homeData.countdownMs} groups={homeData.lineupGroups} />
        );
      case 'state4':
        return (
          <HomeOffDayCard
            nextGame={homeData.nextGame}
            playerCount={homeData.nextGamePlayerCount}
            week={homeData.nflState?.week ?? 0}
          />
        );
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing.xl }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.textPrimary}
        />
      }
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Home</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/(app)/settings')}
          style={styles.settingsButton}
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <LoadingState message="Loading…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={onRefresh} />
      ) : (
        renderBody()
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingVertical: theme.spacing.xl,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  settingsButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  settingsButtonText: {
    color: theme.colors.accent,
    fontSize: theme.type.body.size,
    fontWeight: '600',
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.title.size,
    fontWeight: theme.type.title.weight,
  },
});
