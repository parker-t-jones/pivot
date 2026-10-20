import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { GameLinksProvider } from '../contexts/GameLinksContext';
import {
  MNF_AIRINGS,
  MNF_BROADCAST,
  MNF_GAME_ID,
  MNF_HALFTIME_LIVE,
  MNF_STARTERS,
} from '../fixtures/mnfHalftime';
import type { BoardWindowGroup } from '../lib/board';
import { DESKTOP_RIGHT_COLUMN, DESKTOP_WIDE_MIN } from '../lib/desktopLayout';
import type { LineupGameGroup } from '../lib/homeState';
import { buildLiveStakeCards } from '../lib/liveStakeCards';
import type { LiveGame, ScheduleGame } from '../lib/schedule';
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
  const active = state === 'active' || state === 'redzone';
  const cards = buildLiveStakeCards({
    liveGames: [gameFor(state)],
    stakeGameIds: new Set([MNF_GAME_ID]),
    activeFlags: active ? [{ game_id: MNF_GAME_ID, priority_score: 6 }] : [],
    playersByGameId: new Map([[MNF_GAME_ID, [...MNF_STARTERS]]]),
    betsByGameId: new Map([
      [
        MNF_GAME_ID,
        [
          { id: 'ml', eyebrow: 'BET' as const, label: 'SEA ML' },
          { id: 'pool', eyebrow: 'POOL' as const, label: 'Survivor · JAX' },
        ],
      ],
    ]),
    watchByGameId: new Map([[MNF_GAME_ID, { broadcasts: [MNF_BROADCAST], airings: MNF_AIRINGS }]]),
  });

  const { width } = useWindowDimensions();
  const stakesWidth = width >= DESKTOP_WIDE_MIN ? DESKTOP_RIGHT_COLUMN : width;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Live card preview</Text>
      <Text style={styles.copy}>
        Local only. The halftime score is the Monday night capture. The other states reuse that
        game and change the clock, possession, and whether a stake is active. YOUR STAKES is the
        desktop column width at 1280 and the full window below that.
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
        <Text style={styles.title}>YOUR STAKES</Text>
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
        stakeCount: 2,
        stripeSide: 'away',
      },
      {
        gameId: 'final-den',
        kickoff: new Date('2026-10-18T17:00:00Z'),
        status: 'final',
        awayTeamId: 'NYJ',
        homeTeamId: 'DEN',
        awayTeamColor: '#125740',
        homeTeamColor: '#FB4F14',
        network: 'CBS',
        stakeCount: 1,
        stripeSide: 'home',
      },
    ],
  },
];

const PREVIEW_LINEUP: LineupGameGroup[] = [
  {
    game: previewSchedule,
    players: [
      {
        player_id: 'sf-kittle',
        first_name: 'George',
        last_name: 'Kittle',
        position: 'TE',
        team_abbreviation: 'SF',
      },
    ],
  },
];

const PREVIEW_BETS = [
  {
    kind: 'bet' as const,
    gameId: MNF_GAME_ID,
    teamId: 'SF',
    eyebrow: 'BET' as const,
    label: '49ers moneyline stays on one line beside the saved link',
  },
  {
    kind: 'bet' as const,
    gameId: 'final-den',
    teamId: 'DEN',
    eyebrow: 'BET' as const,
    label: 'DEN ML',
  },
];

const PREVIEW_LINKS = [
  {
    game_id: MNF_GAME_ID,
    url: 'https://tv.youtube.com/watch/very-long-saved-link-that-must-not-eat-the-matchup',
    host: 'tv.youtube.com',
    updated_at: '2026-10-20T00:31:23.885Z',
  },
];

const styles = StyleSheet.create({
  copy: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption.size,
    lineHeight: theme.type.caption.lineHeight,
  },
  page: {
    backgroundColor: theme.colors.background,
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
