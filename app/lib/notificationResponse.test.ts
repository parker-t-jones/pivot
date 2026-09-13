import { describe, expect, it, vi } from 'vitest';
import type { FlagEventPayload } from './flagEventPayload';
import {
  applyNotificationResponse,
  DEFAULT_NOTIFICATION_ACTION,
  resolveNotificationUserAction,
  type NotificationResponseLike,
} from './notificationResponse';

function flagPayload(overrides: Partial<FlagEventPayload> = {}): FlagEventPayload {
  return {
    event_id: 'evt-1',
    user_id: 'user-1',
    game_id: 'game-1',
    event_type: 'flag_added',
    old_state: null,
    new_state: {
      gameId: 'game-1',
      flagged: true,
      priorityScore: 80,
      reasons: [{ type: 'offense_active', triggeringPlayerIds: [] }],
      computedAt: 1,
      possession_team: 'IND',
    },
    action: {
      type: 'prompt',
      cta: 'Watch',
      recommended_source: 'sunday_ticket',
      deep_link_url: 'https://tv.youtube.com/live',
    },
    game_summary: {
      home_team: 'IND',
      away_team: 'DEN',
      home_team_name: 'Colts',
      away_team_name: 'Broncos',
      home_team_primary_color: '#002C5F',
      home_team_secondary_color: '#A2AAAD',
      away_team_primary_color: '#FB4F14',
      away_team_secondary_color: '#002244',
      score: { home: 14, away: 10 },
      quarter: 3,
      time_remaining_sec: 400,
      possession_team: null,
      yards_to_endzone: null,
      down: null,
      distance: null,
      in_red_zone: false,
    },
    flagged_players: [],
    ...overrides,
  };
}

function response(
  data: unknown,
  actionIdentifier: string = DEFAULT_NOTIFICATION_ACTION,
  identifier = 'notif-1',
): NotificationResponseLike {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier,
        content: { data },
      },
    },
  };
}

describe('resolveNotificationUserAction', () => {
  it('treats a body tap as switched', () => {
    expect(resolveNotificationUserAction(DEFAULT_NOTIFICATION_ACTION)).toBe('switched');
  });

  it('maps the declared category action ids', () => {
    expect(resolveNotificationUserAction('switch')).toBe('switched');
    expect(resolveNotificationUserAction('dismiss')).toBe('dismissed');
  });

  it('defaults unknown action ids to switched', () => {
    expect(resolveNotificationUserAction('something-else')).toBe('switched');
  });
});

describe('applyNotificationResponse', () => {
  it('ignores non-flag payloads without recording or switching', () => {
    const switchToGame = vi.fn();
    const recordNotificationAction = vi.fn(async () => undefined);

    const result = applyNotificationResponse(response({ hello: 'world' }), {
      switchToGame,
      recordNotificationAction,
    });

    expect(result).toEqual({ handled: false, reason: 'not_flag_event' });
    expect(switchToGame).not.toHaveBeenCalled();
    expect(recordNotificationAction).not.toHaveBeenCalled();
  });

  it('records and switches on a body tap of a flag_event', () => {
    const switchToGame = vi.fn();
    const recordNotificationAction = vi.fn(async () => undefined);
    const payload = flagPayload();

    const result = applyNotificationResponse(response(payload), {
      switchToGame,
      recordNotificationAction,
    });

    expect(result).toEqual({
      handled: true,
      action: 'switched',
      eventId: 'evt-1',
      switched: true,
    });
    expect(recordNotificationAction).toHaveBeenCalledWith('switched', payload);
    expect(switchToGame).toHaveBeenCalledWith({
      gameId: 'game-1',
      deepLinkUrl: 'https://tv.youtube.com/live',
      label: 'DEN @ IND',
      teamName: 'Colts',
      teamColors: { primary: '#002C5F', secondary: '#A2AAAD' },
    });
  });

  it('records a dismiss without switching', () => {
    const switchToGame = vi.fn();
    const recordNotificationAction = vi.fn(async () => undefined);
    const payload = flagPayload();

    const result = applyNotificationResponse(response(payload, 'dismiss'), {
      switchToGame,
      recordNotificationAction,
    });

    expect(result).toEqual({
      handled: true,
      action: 'dismissed',
      eventId: 'evt-1',
      switched: false,
    });
    expect(recordNotificationAction).toHaveBeenCalledWith('dismissed', payload);
    expect(switchToGame).not.toHaveBeenCalled();
  });

  it('still switches when possession is unknown (no team colors)', () => {
    const switchToGame = vi.fn();
    const recordNotificationAction = vi.fn(async () => undefined);
    const payload = flagPayload({
      new_state: {
        gameId: 'game-1',
        flagged: true,
        priorityScore: 80,
        reasons: [],
        computedAt: 1,
        possession_team: null,
      },
    });

    applyNotificationResponse(response(payload), { switchToGame, recordNotificationAction });

    expect(switchToGame).toHaveBeenCalledWith(
      expect.objectContaining({
        teamName: undefined,
        teamColors: null,
      }),
    );
  });
});
