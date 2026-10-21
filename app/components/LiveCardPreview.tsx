import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { GameLinksProvider } from '../contexts/GameLinksContext';
import {
  MNF_AIRINGS,
  MNF_BROADCAST,
  MNF_GAME_ID,
  MNF_HALFTIME_LIVE,
  MNF_STARTERS,
  WEEK_OTHER_STAKES,
} from '../fixtures/mnfHalftime';
import type { BoardWindowGroup } from '../lib/board';
import { DESKTOP_RIGHT_COLUMN, DESKTOP_WIDE_MIN } from '../lib/desktopLayout';
import type { LineupGameGroup } from '../lib/homeState';
import { buildLiveStakeCards } from '../lib/liveStakeCards';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
import { getTeamColors } from '../lib/teamColors';
import { theme } from '../lib/theme';
import { YourLiveGames } from './LiveStakeGameCard';
import { MyCardList } from './MyCardList';

export type LivePreviewState = 'halftime' | 'active' | 'redzone' | 'endq';

const STATES: { id: LivePreviewState; label: string }[] = [
  { id: 'halftime', label: 'Halftime' },
  { id: 'active', label: 'Active' },
  { id: 'redzone', label: 'Red zone' },
  { id: 'endq', label: 'End Q1' },
];

function gameFor(state: LivePreviewState): LiveGame {
  if (state === 'halftime') return MNF_HALFTIME_LIVE;
  if (state === 'endq') {
    return {
      ...MNF_HALFTIME_LIVE,
      quarter: 1,
      time_remaining_sec: 0,
      possession_team: 'SF',
      yards_to_endzone: 35,
      down: 1,
      distance: 10,
      in_red_zone: false,
    };
  }
  if (state === 'redzone') {
    return {
      ...MNF_HALFTIME_LIVE,
      quarter: 3,
      time_remaining_sec: 512,
      possession_team: 'SF',
      yards_to_endzone: 12,
      down: 2,
      distance: 4,
      in_red_zone: true,
    };
  }
  return {
    ...MNF_HALFTIME_LIVE,
    quarter: 3,
    time_remaining_sec: 420,
    possession_team: 'SF',
    yards_to_endzone: 42,
    down: 1,
    distance: 10,
    in_red_zone: false,
  };
}

export function LiveCardPreview({ initial = 'halftime' }: { initial?: LivePreviewState }) {
  const [state, setState] = useState<LivePreviewState>(initial);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const root = document.documentElement;
    const body = document.body;
    const previousRoot = root.style.backgroundColor;
    const previousBody = body.style.backgroundColor;
    root.style.backgroundColor = theme.colors.background;
    body.style.backgroundColor = theme.colors.background;
    return () => {
      root.style.backgroundColor = previousRoot;
      body.style.backgroundColor = previousBody;
    };
  }, []);
  const active = state === 'active' || state === 'redzone';
  const cards = buildLiveStakeCards({
    liveGames: [gameFor(state)],
    stakeGameIds: new Set([MNF_GAME_ID]),
    activeFlags: active
      ? [
          {
            game_id: MNF_GAME_ID,
            priority_score: 6,
            flagged_players: MNF_STARTERS.map((player) => ({ player_id: player.playerId })),
          },
        ]
      : [],
    playersByGameId: new Map([[MNF_GAME_ID, [...MNF_STARTERS]]]),
    betsByGameId: new Map(),
    watchByGameId: new Map([[MNF_GAME_ID, { broadcasts: [MNF_BROADCAST], airings: MNF_AIRINGS }]]),
  });

  const { width } = useWindowDimensions();
  const stakesWidth = width >= DESKTOP_WIDE_MIN ? DESKTOP_RIGHT_COLUMN : width;

  return (
    <ScrollView
      style={[
        styles.scroll,
        Platform.OS === 'web' ? ({ minHeight: '100vh' } as unknown as ViewStyle) : null,
      ]}
      contentContainerStyle={styles.page}
    >
      <Text style={styles.title}>Live card preview</Text>
      <Text style={styles.copy}>
        Local only. Monday night is Commanders D/ST and George Kittle. SEA ML and the JAX pool are
        final games, so they stay on their own YOUR PICKS cards. Halftime and end of quarter leave
        every chip SIDELINE. Active and red zone mark both Monday starters on the flag.
      </Text>
      <View style={styles.row}>
        {STATES.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => setState(item.id)}
            style={[styles.pill, state === item.id && styles.pillOn]}
          >
            <Text style={styles.pillText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <YourLiveGames cards={cards} onSwitch={() => undefined} />
      <View style={{ width: stakesWidth, maxWidth: '100%' }}>
        <Text style={styles.title}>YOUR PICKS</Text>
        <GameLinksProvider fixtureLinks={PREVIEW_LINKS}>
          <MyCardList
            betRefs={PREVIEW_BETS}
            groups={PREVIEW_GROUPS}
            lineupGroups={PREVIEW_LINEUP}
            liveGames={[gameFor(state)]}
            part="cards"
          />
        </GameLinksProvider>
      </View>
    </ScrollView>
  );
}

const previewSchedule: ScheduleGame = {
  ...MNF_HALFTIME_LIVE,
  broadcasts: [MNF_BROADCAST],
  airings: MNF_AIRINGS,
};

const PREVIEW_GROUPS: BoardWindowGroup[] = [
  {
    label: 'MONDAY',
    earliestKickoff: new Date(MNF_HALFTIME_LIVE.scheduled_start),
    rows: [
      {
        gameId: MNF_GAME_ID,
        kickoff: new Date(MNF_HALFTIME_LIVE.scheduled_start),
        status: 'in_progress',
        awayTeamId: 'WAS',
        homeTeamId: 'SF',
        awayTeamColor: MNF_HALFTIME_LIVE.away_team_primary_color,
        homeTeamColor: MNF_HALFTIME_LIVE.home_team_primary_color,
        network: 'ESPN',
        stakeCount: MNF_STARTERS.length,
        stripeSide: 'away',
      },
      ...WEEK_OTHER_STAKES.map((stake) => ({
        gameId: stake.gameId,
        kickoff: new Date(stake.scheduledStart),
        status: stake.status,
        awayTeamId: stake.away,
        homeTeamId: stake.home,
        awayTeamColor: getTeamColors(stake.away).primary,
        homeTeamColor: getTeamColors(stake.home).primary,
        network: stake.network,
        stakeCount: 1,
        stripeSide: stake.home === 'JAX' ? ('home' as const) : ('away' as const),
      })),
    ],
  },
];

const PREVIEW_LINEUP: LineupGameGroup[] = [
  {
    game: previewSchedule,
    players: MNF_STARTERS.map((player) => ({
      player_id: player.playerId,
      first_name: player.firstName,
      last_name: player.lastName,
      position: player.position,
      team_abbreviation: player.teamAbbreviation,
    })),
  },
];

const PREVIEW_BETS = WEEK_OTHER_STAKES.map((stake) => ({
  kind: 'bet' as const,
  gameId: stake.gameId,
  teamId: stake.eyebrow === 'POOL' ? stake.home : stake.away,
  eyebrow: stake.eyebrow,
  label: stake.label,
}));

const PREVIEW_LINKS = [
  {
    game_id: MNF_GAME_ID,
    url: 'https://tv.youtube.com/watch/very-long-saved-link-that-must-not-eat-the-matchup',
    host: 'tv.youtube.com',
    updated_at: '2026-10-20T00:31:23.885Z',
  },
];

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  copy: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  page: {
    backgroundColor: theme.colors.background,
    flexGrow: 1,
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  pill: {
    borderColor: theme.colors.border,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  pillOn: {
    borderColor: theme.colors.accent,
  },
  pillText: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.caption.size,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.smallStrong.size,
    fontWeight: theme.type.smallStrong.weight,
  },
});
