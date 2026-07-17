import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { NowActiveCard } from '../../components/NowActiveCard';
import { useSwitching } from '../../contexts/SwitchingContext';
import { ApiRequestError, apiClient } from '../../lib/apiClient';
import {
  buildPlayerTeamMap,
  fetchAllLineups,
  fetchLeagues,
  type LeagueSummary,
} from '../../lib/leagues';
import {
  pickPreferredBroadcast,
  type CurrentFlag,
  type FlagsCurrentResponse,
  type GameBroadcast,
  type GameBroadcastsResponse,
} from '../../lib/gameDisplay';
import { resolveFlaggedTeamDisplay, type PlayerTeamMap } from '../../lib/teamDisplay';

interface HomeData {
  /** Sprint 9 Phase 2 — Home State 5: no leagues connected yet. Checked before anything else, since
   *  an empty lineup means `/flags/current` can never return anything for this user (see `flags.ts`'s
   *  own early return on an empty lineup cache) — no point fetching it. */
  hasLeagues: boolean;
  lineupPlayerCount: number;
  playerTeamMap: PlayerTeamMap;
  flag: CurrentFlag | null;
  broadcast: GameBroadcast | null;
  /** Full ranked list (not just the preferred pick) — handed to `switchToGame` so the Section 10
   *  deep-link error state's alternate-broadcast picker doesn't need to refetch it. */
  broadcasts: GameBroadcast[];
}

const EMPTY_TEAM_MAP: PlayerTeamMap = new Map();

export default function HomeScreen() {
  const router = useRouter();
  const { switchToGame } = useSwitching();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<HomeData | null>(null);

  /**
   * Section 10 Home states 1/5/"idle" data path (see report for why states 2–4's live-score/
   * kickoff-countdown fidelity is deliberately out of scope this phase — no `GET /games?week=` or
   * `GET /games/live` endpoint exists to back them). `/flags/current` gives the top-priority flagged
   * game; `GET /leagues` + `GET /leagues/:id/lineup` give State 5's "do you have a team connected"
   * check and the player->team map the reason chip / color flash need (Sprint 9 Phase 2 — see
   * `teamDisplay.ts`). All cold-start reads — live deltas over WebSocket are a later concern (no
   * client socket yet).
   */
  const loadHome = useCallback(async () => {
    setLoadError(null);
    try {
      const leagues: LeagueSummary[] = await fetchLeagues();
      if (leagues.length === 0) {
        setHomeData({
          hasLeagues: false,
          lineupPlayerCount: 0,
          playerTeamMap: EMPTY_TEAM_MAP,
          flag: null,
          broadcast: null,
          broadcasts: [],
        });
        return;
      }

      const lineups = await fetchAllLineups(leagues);
      const playerTeamMap = buildPlayerTeamMap(lineups);
      const lineupPlayerCount = new Set(lineups.flatMap((l) => l.slots.map((s) => s.player.player_id)))
        .size;

      const { flags } = await apiClient.get<FlagsCurrentResponse>('/flags/current');
      const topFlag = flags[0] ?? null;

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
          // A broadcast-lookup failure shouldn't hide the flagged game — render the card with a
          // disabled CTA (Section 10 graceful degradation) rather than an error screen.
          console.warn('[home] failed to load broadcasts', error);
        }
      }

      setHomeData({
        hasLeagues: true,
        lineupPlayerCount,
        playerTeamMap,
        flag: topFlag,
        broadcast,
        broadcasts,
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
    const flaggedTeam = resolveFlaggedTeamDisplay(flag.game, flag.flagged_players, homeData.playerTeamMap);
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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#fff" />
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
        <LoadingState message="Pulling up today's games…" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={onRefresh} />
      ) : !homeData?.hasLeagues ? (
        <EmptyState
          title="Connect your fantasy team to get started"
          message="We'll watch every game your players are in and tell you the moment to switch over."
          primaryAction={{
            label: 'Connect Sleeper',
            // `onboarding=1` continues into the streaming-services/all-set steps on success —
            // deliberately unconditional (not just for a *just-signed-up* user) so "connect your
            // first team" is what triggers the rest of setup, not a timing signal that's fragile to
            // detect (see report on why this is cleaner than trying to distinguish "just signed up"
            // from "signed in a while ago but never connected a team").
            onPress: () => router.push('/(app)/connect-team?provider=sleeper&onboarding=1'),
          }}
          secondaryAction={{
            label: 'Add manually',
            onPress: () => router.push('/(app)/connect-team?provider=manual&onboarding=1'),
          }}
        />
      ) : homeData.flag ? (
        <NowActiveCard
          flag={homeData.flag}
          broadcast={homeData.broadcast}
          playerTeamMap={homeData.playerTeamMap}
          onSwitch={onSwitch}
        />
      ) : (
        <EmptyState
          title="No games are flagged right now"
          message="We'll surface one the moment your players get active."
        >
          {homeData.lineupPlayerCount > 0 ? (
            <Text style={styles.lineupSummary}>
              {homeData.lineupPlayerCount} player{homeData.lineupPlayerCount === 1 ? '' : 's'} in your
              lineup this week.
            </Text>
          ) : null}
        </EmptyState>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  lineupSummary: {
    color: '#5aa2ff',
    fontSize: 13,
    fontWeight: '600',
  },
  screen: {
    backgroundColor: '#000',
    flex: 1,
  },
  settingsButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  settingsButtonText: {
    color: '#5aa2ff',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
});
