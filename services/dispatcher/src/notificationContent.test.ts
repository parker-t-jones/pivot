import type { FlagEvent, FlagReason, FlagState } from '@roster-remote/shared';
import { describe, expect, it } from 'vitest';
import type { PlayerInfo } from './catalogs.js';
import {
  notificationBody,
  notificationTitle,
  type NotificationGameContext,
} from './notificationContent.js';

const JONATHAN_TAYLOR: PlayerInfo = {
  playerId: 'p1',
  firstName: 'Jonathan',
  lastName: 'Taylor',
  position: 'RB',
};
const MICHAEL_PITTMAN: PlayerInfo = {
  playerId: 'p2',
  firstName: 'Michael',
  lastName: 'Pittman',
  position: 'WR',
};
const KYLER_MURRAY: PlayerInfo = { playerId: 'p3', firstName: 'Kyler', lastName: 'Murray', position: 'QB' };

function reason(type: FlagReason['type'], triggeringPlayerIds: string[] = []): FlagReason {
  return { type, triggeringPlayerIds };
}

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 10,
    reasons: [reason('offense_active', ['p1'])],
    computedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FlagEvent> = {}): FlagEvent {
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: makeFlagState(),
    scheduledFireAt: 1_700_000_060_000,
    ...overrides,
  };
}

function makeGame(overrides: Partial<NotificationGameContext> = {}): NotificationGameContext {
  return {
    possessionTeamName: 'Colts',
    defenseTeamName: 'Broncos',
    quarter: 2,
    timeRemainingSec: 434, // 7:14
    ...overrides,
  };
}

describe('notificationTitle', () => {
  it('single offense player -> "{First} {Last} active"', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('offense_active', ['p1'])] }) });
    expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR])).toBe('Jonathan Taylor active');
  });

  it('multiple offense players -> "N of your players active"', () => {
    const event = makeEvent({
      newState: makeFlagState({ reasons: [reason('offense_active', ['p1', 'p2', 'p3'])] }),
    });
    expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR, MICHAEL_PITTMAN, KYLER_MURRAY])).toBe(
      '3 of your players active',
    );
  });

  it('defense flag with no offense -> "{Team} defense on the field"', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('defense_active', ['def-1'])] }) });
    expect(notificationTitle(event, makeGame({ defenseTeamName: 'Broncos' }), [])).toBe(
      'Broncos defense on the field',
    );
  });

  it('falls back to a generic defense label when defenseTeamName is unresolved', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('defense_active', ['def-1'])] }) });
    expect(notificationTitle(event, makeGame({ defenseTeamName: null }), [])).toBe(
      'Your defense defense on the field',
    );
  });

  it('offense wins over defense when both reasons fire simultaneously (Section 8 both-teams edge case)', () => {
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [reason('offense_active', ['p1']), reason('defense_active', ['def-1'])],
      }),
    });
    expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR])).toBe('Jonathan Taylor active');
  });

  it('bonus-only reasons alongside offense_active do not change the title subject', () => {
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [
          reason('offense_active', ['p1']),
          reason('red_zone'),
          reason('close_game'),
          reason('star_player_active', ['p1']),
        ],
      }),
    });
    expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR])).toBe('Jonathan Taylor active');
  });

  it('treats priority_increased/priority_decreased the same as flag_added (reads newState)', () => {
    const reasons = [reason('offense_active', ['p1', 'p2'])];
    for (const type of ['priority_increased', 'priority_decreased'] as const) {
      const event = makeEvent({ type, newState: makeFlagState({ reasons }) });
      expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR, MICHAEL_PITTMAN])).toBe(
        '2 of your players active',
      );
    }
  });

  describe('flag_removed (reads oldState, past tense)', () => {
    it('single offense player -> "no longer active"', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('offense_active', ['p1'])] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR])).toBe('Jonathan Taylor no longer active');
    });

    it('multiple offense players -> "N of your players no longer active"', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('offense_active', ['p1', 'p2'])] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationTitle(event, makeGame(), [JONATHAN_TAYLOR, MICHAEL_PITTMAN])).toBe(
        '2 of your players no longer active',
      );
    });

    it('defense-only -> "{Team} defense no longer on the field"', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('defense_active', ['def-1'])] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationTitle(event, makeGame({ defenseTeamName: 'Broncos' }), [])).toBe(
        'Broncos defense no longer on the field',
      );
    });

    it('missing oldState (defensive fallback) does not throw', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: null,
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationTitle(event, makeGame(), [])).toBe('Your players no longer active');
    });
  });

  it('falls back gracefully when reasons are empty (malformed/unexpected input)', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [] }) });
    expect(notificationTitle(event, makeGame(), [])).toBe('Your players active');
  });

  it('falls back when offense_active has ids but none resolve against the given players list', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('offense_active', ['unknown'])] }) });
    expect(notificationTitle(event, makeGame(), [])).toBe('Your players active');
  });
});

describe('notificationBody', () => {
  it('default flagged body matches the Section 10 example exactly', () => {
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('offense_active', ['p1'])] }) });
    expect(notificationBody(event, makeGame({ possessionTeamName: 'Colts', quarter: 2, timeRemainingSec: 434 }))).toBe(
      'Colts have the ball — Q2, 7:14. Tap to watch.',
    );
  });

  it('pads single-digit seconds', () => {
    const event = makeEvent();
    expect(notificationBody(event, makeGame({ timeRemainingSec: 61 }))).toContain('1:01');
  });

  it('labels quarter 5 as OT', () => {
    const event = makeEvent();
    expect(notificationBody(event, makeGame({ quarter: 5, timeRemainingSec: 120 }))).toContain('OT, 2:00');
  });

  it('falls back to a generic subject when possessionTeamName is unresolved', () => {
    const event = makeEvent();
    expect(notificationBody(event, makeGame({ possessionTeamName: null }))).toBe(
      'The offense have the ball — Q2, 7:14. Tap to watch.',
    );
  });

  it('describes the possessing team even when the flag fired via defense_active (field state, not fantasy stake)', () => {
    // The user's Broncos defense triggered this flag, but the Colts are the ones with the ball —
    // the body must describe the Colts, not the Broncos.
    const event = makeEvent({ newState: makeFlagState({ reasons: [reason('defense_active', ['def-1'])] }) });
    expect(notificationBody(event, makeGame({ possessionTeamName: 'Colts' }))).toBe(
      'Colts have the ball — Q2, 7:14. Tap to watch.',
    );
  });

  describe('red_zone reason -> different body', () => {
    it('swaps the "have the ball" clause for "in the red zone"', () => {
      const event = makeEvent({
        newState: makeFlagState({ reasons: [reason('offense_active', ['p1']), reason('red_zone')] }),
      });
      expect(notificationBody(event, makeGame())).toBe('Colts in the red zone — Q2, 7:14. Tap to watch.');
    });

    it('applies on flag_added, not just priority_increased', () => {
      const event = makeEvent({
        type: 'flag_added',
        newState: makeFlagState({ reasons: [reason('offense_active', ['p1']), reason('red_zone')] }),
      });
      expect(notificationBody(event, makeGame())).toContain('in the red zone');
    });

    it('applies on priority_decreased too (red_zone can persist while priority drops)', () => {
      const event = makeEvent({
        type: 'priority_decreased',
        newState: makeFlagState({ reasons: [reason('offense_active', ['p1']), reason('red_zone')] }),
      });
      expect(notificationBody(event, makeGame())).toContain('in the red zone');
    });
  });

  it('close_game and star_player_active bonuses do NOT trigger the red-zone-style body', () => {
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [reason('offense_active', ['p1']), reason('close_game'), reason('star_player_active', ['p1'])],
      }),
    });
    expect(notificationBody(event, makeGame())).toBe('Colts have the ball — Q2, 7:14. Tap to watch.');
  });

  describe('flag_removed', () => {
    it('reflects the possession change using the current possessing team', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('offense_active', ['p1'])] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationBody(event, makeGame({ possessionTeamName: 'Broncos' }))).toBe(
        'Possession changed — Broncos has the ball now.',
      );
    });

    it('falls back to a generic message when possessionTeamName is unresolved', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('offense_active', ['p1'])] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationBody(event, makeGame({ possessionTeamName: null }))).toBe('Possession has changed.');
    });

    it('ignores red_zone/newState entirely for flag_removed (newState.reasons is always empty)', () => {
      const event = makeEvent({
        type: 'flag_removed',
        oldState: makeFlagState({ reasons: [reason('offense_active', ['p1']), reason('red_zone')] }),
        newState: makeFlagState({ flagged: false, priorityScore: 0, reasons: [] }),
      });
      expect(notificationBody(event, makeGame({ possessionTeamName: 'Broncos' }))).toBe(
        'Possession changed — Broncos has the ball now.',
      );
    });
  });
});
