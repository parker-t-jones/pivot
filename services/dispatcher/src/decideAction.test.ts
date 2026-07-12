import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@fantasy-focus/shared';
import { decideAction, type DecideActionSession, type DecideActionUser } from './decideAction.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 10,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
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

const freeUser: DecideActionUser = { subscriptionTier: 'free', autoSwitch: false };
const proUser: DecideActionUser = { subscriptionTier: 'pro', autoSwitch: false };
const autoSwitchUser: DecideActionUser = { subscriptionTier: 'free', autoSwitch: true };
const noSession: DecideActionSession = { primaryGameId: null, primaryPriorityScore: null };

describe('decideAction', () => {
  it('flag_removed always yields notify_only/dismiss regardless of priority or session', () => {
    const event = makeEvent({
      type: 'flag_removed',
      newState: makeFlagState({ flagged: false, priorityScore: 0 }),
    });
    expect(decideAction(proUser, { primaryGameId: 'g1', primaryPriorityScore: 5 }, event)).toEqual({
      type: 'notify_only',
      cta: 'dismiss',
    });
  });

  it('is already the primary game -> in_app_indicator (currentPrimaryPriority is Infinity)', () => {
    const session: DecideActionSession = { primaryGameId: 'g1', primaryPriorityScore: 3 };
    expect(decideAction(freeUser, session, makeEvent())).toEqual({
      type: 'in_app_indicator',
      cta: null,
    });
  });

  it('no session/primary game yet -> treated as priority 0, so a positive-priority event prompts a switch', () => {
    // currentPrimaryPriority = session.primaryPriorityScore ?? 0 = 0; event priority (10) > 0.
    expect(decideAction(freeUser, noSession, makeEvent())).toEqual({
      type: 'prompt',
      cta: 'switch_primary',
    });
  });

  it('higher priority than current primary + autoSwitch on -> auto_switch', () => {
    const session: DecideActionSession = { primaryGameId: 'g2', primaryPriorityScore: 4 };
    const event = makeEvent({ newState: makeFlagState({ priorityScore: 10 }) });
    expect(decideAction(autoSwitchUser, session, event)).toEqual({
      type: 'auto_switch',
      cta: null,
    });
  });

  it('higher priority than current primary + autoSwitch off -> prompt/switch_primary', () => {
    const session: DecideActionSession = { primaryGameId: 'g2', primaryPriorityScore: 4 };
    const event = makeEvent({ newState: makeFlagState({ priorityScore: 10 }) });
    expect(decideAction(freeUser, session, event)).toEqual({
      type: 'prompt',
      cta: 'switch_primary',
    });
  });

  it('lower/equal priority than current primary + pro tier -> prompt/add_to_split', () => {
    const session: DecideActionSession = { primaryGameId: 'g2', primaryPriorityScore: 20 };
    const event = makeEvent({ newState: makeFlagState({ priorityScore: 10 }) });
    expect(decideAction(proUser, session, event)).toEqual({ type: 'prompt', cta: 'add_to_split' });
  });

  it('lower/equal priority than current primary + free tier -> prompt_low_priority/switch_primary', () => {
    const session: DecideActionSession = { primaryGameId: 'g2', primaryPriorityScore: 20 };
    const event = makeEvent({ newState: makeFlagState({ priorityScore: 10 }) });
    expect(decideAction(freeUser, session, event)).toEqual({
      type: 'prompt_low_priority',
      cta: 'switch_primary',
    });
  });

  it('equal priority counts as NOT greater -> falls through to the tier branch', () => {
    const session: DecideActionSession = { primaryGameId: 'g2', primaryPriorityScore: 10 };
    const event = makeEvent({ newState: makeFlagState({ priorityScore: 10 }) });
    expect(decideAction(freeUser, session, event)).toEqual({
      type: 'prompt_low_priority',
      cta: 'switch_primary',
    });
  });
});
