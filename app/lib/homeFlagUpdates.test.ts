import { describe, expect, it } from 'vitest';

import type { FlagEventPayload } from './flagEventPayload';
import type { CurrentFlag } from './gameDisplay';
import {
  applyFlagEventToHome,
  flagEventToCurrentFlag,
  reconcileHomeWithFlagsCurrent,
  recommendedActionFromFlagEvent,
  type HomeFlagSlice,
} from './homeFlagUpdates';
import type { NflStateResponse } from './nflState';

const NFL: NflStateResponse = {
  season: '2026',
  week: 1,
  season_type: 'regular',
  season_start_date: null,
  preseason_start: '2026-08-06',
  regular_season_start: '2026-09-09',
  display_phase: 'regular',
};

function baseSlice(overrides: Partial<HomeFlagSlice> = {}): HomeFlagSlice {
  return {
    hasLeagues: true,
    nflState: NFL,
    playerTeamMap: new Map(),
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
    branch: { branch: 'state4' },
    ...overrides,
  };
}

function flagPayload(
  partial: Partial<FlagEventPayload> & Pick<FlagEventPayload, 'event_type' | 'game_id'>,
): FlagEventPayload {
  const { event_type, game_id, new_state, action, game_summary, ...rest } = partial;
  return {
    event_id: 'evt-1',
    user_id: 'user-1',
    game_id,
    event_type,
    old_state: null,
    new_state: {
      gameId: game_id,
      flagged: event_type !== 'flag_removed',
      priorityScore: 50,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
      computedAt: 1,
      possession_team: 'KC',
      ...new_state,
    },
    action: {
      type: 'prompt',
      cta: 'switch_primary',
      recommended_source: null,
      deep_link_url: null,
      ...action,
    },
    game_summary: {
      home_team: 'KC',
      away_team: 'BUF',
      home_team_name: 'Chiefs',
      away_team_name: 'Bills',
      home_team_primary_color: '#E31837',
      home_team_secondary_color: '#FFB81C',
      away_team_primary_color: '#00338D',
      away_team_secondary_color: '#C60C30',
      score: { home: 14, away: 7 },
      quarter: 2,
      time_remaining_sec: 400,
      possession_team: null,
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
      ...game_summary,
    },
    flagged_players: [
      { player_id: 'p1', first_name: 'Patrick', last_name: 'Mahomes', position: 'QB' },
    ],
    ...rest,
  };
}

function currentFlag(gameId: string, priority: number): CurrentFlag {
  return {
    game_id: gameId,
    priority_score: priority,
    reasons: ['offense_active'],
    flagged_players: [
      { player_id: 'p1', first_name: 'Patrick', last_name: 'Mahomes', position: 'QB' },
    ],
    game: {
      home_team: 'KC',
      away_team: 'BUF',
      home_team_name: 'Chiefs',
      away_team_name: 'Bills',
      home_team_primary_color: '#E31837',
      home_team_secondary_color: '#FFB81C',
      away_team_primary_color: '#00338D',
      away_team_secondary_color: '#C60C30',
      score: { home: 14, away: 7 },
      quarter: 2,
      time_remaining_sec: 400,
      possession_team: null,
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    },
    recommended_action: 'switch_primary',
  };
}

describe('recommendedActionFromFlagEvent', () => {
  it('maps CTA to /flags/current recommended_action values', () => {
    expect(
      recommendedActionFromFlagEvent({
        type: 'prompt',
        cta: 'switch_primary',
        recommended_source: null,
        deep_link_url: null,
      }),
    ).toBe('switch_primary');
    expect(
      recommendedActionFromFlagEvent({
        type: 'prompt',
        cta: 'add_to_split',
        recommended_source: null,
        deep_link_url: null,
      }),
    ).toBe('add_to_split');
    expect(
      recommendedActionFromFlagEvent({
        type: 'notify_only',
        cta: null,
        recommended_source: null,
        deep_link_url: null,
      }),
    ).toBe('notify_only');
  });
});

describe('applyFlagEventToHome', () => {
  const now = new Date('2026-09-13T18:00:00Z');

  it('flag_added with no current flag → State 1 and needs broadcast fetch', () => {
    const result = applyFlagEventToHome(
      baseSlice(),
      flagPayload({ event_type: 'flag_added', game_id: 'g1' }),
      now,
    );
    expect(result.slice.branch).toEqual({ branch: 'state1' });
    expect(result.slice.flag?.game_id).toBe('g1');
    expect(result.needsBroadcastFetch).toBe(true);
    expect(result.broadcastGameId).toBe('g1');
  });

  it('priority_increased on current game updates in place without broadcast refetch', () => {
    const result = applyFlagEventToHome(
      baseSlice({
        flag: currentFlag('g1', 40),
        branch: { branch: 'state1' },
        broadcasts: [
          {
            service: 'cbs',
            deep_link_url: 'cbs://x',
            requires_subscription: false,
            user_has_subscription: true,
            typical_lag_seconds: 15,
            preferred: true,
          },
        ],
      }),
      flagPayload({
        event_type: 'priority_increased',
        game_id: 'g1',
        new_state: {
          gameId: 'g1',
          flagged: true,
          priorityScore: 80,
          reasons: [{ type: 'red_zone', triggeringPlayerIds: ['p1'] }],
          computedAt: 2,
          possession_team: 'KC',
        },
      }),
      now,
    );
    expect(result.slice.flag?.priority_score).toBe(80);
    expect(result.slice.flag?.reasons).toEqual(['red_zone']);
    expect(result.needsBroadcastFetch).toBe(false);
    expect(result.slice.broadcasts).toHaveLength(1);
  });

  it('flag_removed for current game clears State 1', () => {
    const result = applyFlagEventToHome(
      baseSlice({
        flag: currentFlag('g1', 50),
        branch: { branch: 'state1' },
      }),
      flagPayload({ event_type: 'flag_removed', game_id: 'g1' }),
      now,
    );
    expect(result.slice.flag).toBeNull();
    expect(result.slice.branch).toEqual({ branch: 'state4' });
    expect(result.needsBroadcastFetch).toBe(false);
  });

  it('flag_removed for a different game is a no-op', () => {
    const slice = baseSlice({
      flag: currentFlag('g1', 50),
      branch: { branch: 'state1' },
    });
    const result = applyFlagEventToHome(
      slice,
      flagPayload({ event_type: 'flag_removed', game_id: 'other' }),
      now,
    );
    expect(result.slice.flag?.game_id).toBe('g1');
    expect(result.slice.branch).toEqual({ branch: 'state1' });
  });

  it('flag_added with higher priority than current replaces State 1', () => {
    const result = applyFlagEventToHome(
      baseSlice({
        flag: currentFlag('g-low', 30),
        branch: { branch: 'state1' },
      }),
      flagPayload({
        event_type: 'flag_added',
        game_id: 'g-high',
        new_state: {
          gameId: 'g-high',
          flagged: true,
          priorityScore: 90,
          reasons: [{ type: 'red_zone', triggeringPlayerIds: ['p1'] }],
          computedAt: 3,
          possession_team: 'BUF',
        },
      }),
      now,
    );
    expect(result.slice.flag?.game_id).toBe('g-high');
    expect(result.needsBroadcastFetch).toBe(true);
  });

  it('flag_added with lower priority than current does not replace State 1', () => {
    const result = applyFlagEventToHome(
      baseSlice({
        flag: currentFlag('g-high', 90),
        branch: { branch: 'state1' },
      }),
      flagPayload({
        event_type: 'flag_added',
        game_id: 'g-low',
        new_state: {
          gameId: 'g-low',
          flagged: true,
          priorityScore: 20,
          reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
          computedAt: 3,
          possession_team: 'BUF',
        },
      }),
      now,
    );
    expect(result.slice.flag?.game_id).toBe('g-high');
    expect(result.needsBroadcastFetch).toBe(false);
  });
});

describe('reconcileHomeWithFlagsCurrent', () => {
  const now = new Date('2026-09-13T18:00:00Z');

  it('applies a flag that appeared while the socket was down', () => {
    const incoming = currentFlag('gap-game', 70);
    const result = reconcileHomeWithFlagsCurrent(
      baseSlice({ branch: { branch: 'state4' } }),
      { flags: [incoming], generated_at: now.toISOString() },
      now,
    );
    expect(result.slice.flag?.game_id).toBe('gap-game');
    expect(result.slice.branch).toEqual({ branch: 'state1' });
    expect(result.needsBroadcastFetch).toBe(true);
  });

  it('clears State 1 when /flags/current returns empty after a gap', () => {
    const result = reconcileHomeWithFlagsCurrent(
      baseSlice({
        flag: currentFlag('gone', 50),
        branch: { branch: 'state1' },
      }),
      { flags: [], generated_at: now.toISOString() },
      now,
    );
    expect(result.slice.flag).toBeNull();
    expect(result.slice.branch).toEqual({ branch: 'state4' });
  });
});

describe('flagEventToCurrentFlag', () => {
  it('maps wire payload fields onto CurrentFlag', () => {
    const flag = flagEventToCurrentFlag(
      flagPayload({ event_type: 'flag_added', game_id: 'g1' }),
    );
    expect(flag.game_id).toBe('g1');
    expect(flag.priority_score).toBe(50);
    expect(flag.reasons).toEqual(['offense_active']);
    expect(flag.recommended_action).toBe('switch_primary');
  });
});
