import { describe, expect, it } from 'vitest';
import type { FlagEvent, FlagState } from '@pivot/shared';
import { parseQueuedFlagEvent, serializeQueuedFlagEvent } from './queue.js';

function event(): FlagEvent {
  const state: FlagState = {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
    reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
    computedAt: 1_000,
  };
  return {
    id: 'evt-1',
    userId: 'u1',
    gameId: 'g1',
    type: 'flag_added',
    oldState: null,
    newState: state,
    scheduledFireAt: 5_000,
  };
}

describe('queued flag event codec', () => {
  it('leaves a member without a play id as the event json', () => {
    const flagEvent = event();
    const raw = serializeQueuedFlagEvent(flagEvent, null);
    expect(raw).toBe(JSON.stringify(flagEvent));
    expect(parseQueuedFlagEvent(raw)).toEqual({ event: flagEvent, triggeringPlayId: null });
  });

  it('round-trips a play id without leaving it on FlagEvent', () => {
    const flagEvent = event();
    const parsed = parseQueuedFlagEvent(serializeQueuedFlagEvent(flagEvent, 'play-1'));
    expect(parsed.triggeringPlayId).toBe('play-1');
    expect(parsed.event).toEqual(flagEvent);
    expect(parsed.event).not.toHaveProperty('triggeringPlayId');
  });

  it('round-trips optional timing fields on the event', () => {
    const flagEvent = {
      ...event(),
      playWallclock: '2026-10-11T17:00:00.000Z',
      seenAt: '2026-10-11T17:00:02.500Z',
      enqueuedAt: '2026-10-11T17:00:04.000Z',
    };
    const parsed = parseQueuedFlagEvent(serializeQueuedFlagEvent(flagEvent, 'play-1'));
    expect(parsed.triggeringPlayId).toBe('play-1');
    expect(parsed.event).toEqual(flagEvent);
    expect(parsed.event).not.toHaveProperty('triggeringPlayId');
  });
});
