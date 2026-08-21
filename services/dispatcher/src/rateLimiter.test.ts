import { describe, expect, it } from 'vitest';
import { parsePreferences, type FlagEvent, type FlagState } from '@roster-remote/shared';
import { InMemoryRateLimitStore, isInQuietHours, shouldRateLimit } from './rateLimiter.js';

function makeFlagState(overrides: Partial<FlagState> = {}): FlagState {
  return {
    gameId: 'g1',
    flagged: true,
    priorityScore: 5,
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

const NOW = 1_700_000_060_000;

describe('shouldRateLimit — sliding 60s window (<3 per minute)', () => {
  it('allows the first event with an empty window', async () => {
    const store = new InMemoryRateLimitStore();
    expect(await shouldRateLimit(makeEvent(), parsePreferences({}), store, NOW)).toBe(false);
  });

  it('allows the 3rd event (count is checked BEFORE recording, so 2 existing + this one = 3 total, not limited)', async () => {
    const store = new InMemoryRateLimitStore();
    await store.recordNotification('u1', 'e1', NOW - 10_000);
    await store.recordNotification('u1', 'e2', NOW - 5_000);
    expect(await shouldRateLimit(makeEvent(), parsePreferences({}), store, NOW)).toBe(false);
  });

  it('rate-limits the 4th event within the window (3 already recorded)', async () => {
    const store = new InMemoryRateLimitStore();
    await store.recordNotification('u1', 'e1', NOW - 30_000);
    await store.recordNotification('u1', 'e2', NOW - 20_000);
    await store.recordNotification('u1', 'e3', NOW - 10_000);
    expect(await shouldRateLimit(makeEvent({ id: 'e4' }), parsePreferences({}), store, NOW)).toBe(
      true,
    );
  });

  it('does not count notifications outside the 60s window', async () => {
    const store = new InMemoryRateLimitStore();
    await store.recordNotification('u1', 'e1', NOW - 90_000);
    await store.recordNotification('u1', 'e2', NOW - 61_000);
    await store.recordNotification('u1', 'e3', NOW - 61_000);
    // All 3 are outside [now-60000, now] -> window is effectively empty.
    expect(await shouldRateLimit(makeEvent({ id: 'e4' }), parsePreferences({}), store, NOW)).toBe(
      false,
    );
  });

  it('rate limiting is per-user — another user is unaffected', async () => {
    const store = new InMemoryRateLimitStore();
    await store.recordNotification('u1', 'e1', NOW - 10_000);
    await store.recordNotification('u1', 'e2', NOW - 10_000);
    await store.recordNotification('u1', 'e3', NOW - 10_000);
    expect(
      await shouldRateLimit(makeEvent({ userId: 'u2' }), parsePreferences({}), store, NOW),
    ).toBe(false);
  });

  it('records the notification via the store write side (decision #8) — write must be observable', async () => {
    const store = new InMemoryRateLimitStore();
    await store.recordNotification('u1', 'evt-1', NOW);
    expect(store.entriesFor('u1')).toEqual([{ eventId: 'evt-1', deliveredAtMs: NOW }]);
  });

  it('a 4th delivery is correctly rate-limited only AFTER the 3rd was actually recorded', async () => {
    // Exercises the full write-then-read cycle: record 3 real deliveries via the store's write path,
    // then confirm the 4th is limited. Verifies the write side and the read side agree.
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({});
    for (let i = 0; i < 3; i += 1) {
      const t = NOW - (3 - i) * 1000;
      expect(await shouldRateLimit(makeEvent({ id: `e${i}` }), prefs, store, t)).toBe(false);
      await store.recordNotification('u1', `e${i}`, t);
    }
    expect(await shouldRateLimit(makeEvent({ id: 'e-4th' }), prefs, store, NOW)).toBe(true);
  });
});

describe('shouldRateLimit — quiet hours', () => {
  it('suppresses when quiet hours are enabled and now falls inside a non-wrapping window', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({
      quietHours: { enabled: true, startHour: 1, endHour: 5, timezone: 'UTC' },
    });
    const now = Date.UTC(2026, 0, 1, 3, 0, 0); // 3 AM UTC, inside [1, 5)
    expect(await shouldRateLimit(makeEvent(), prefs, store, now)).toBe(true);
  });

  it('does not suppress outside a non-wrapping window', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({
      quietHours: { enabled: true, startHour: 1, endHour: 5, timezone: 'UTC' },
    });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0); // noon UTC
    expect(await shouldRateLimit(makeEvent(), prefs, store, now)).toBe(false);
  });

  it('handles a midnight-wrapping window (22 -> 8)', () => {
    const prefs = parsePreferences({
      quietHours: { enabled: true, startHour: 22, endHour: 8, timezone: 'UTC' },
    });
    expect(isInQuietHours(prefs, new Date(Date.UTC(2026, 0, 1, 23, 0, 0)))).toBe(true); // 11 PM
    expect(isInQuietHours(prefs, new Date(Date.UTC(2026, 0, 1, 3, 0, 0)))).toBe(true); // 3 AM
    expect(isInQuietHours(prefs, new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))).toBe(false); // noon
  });

  it('is a no-op when quiet hours are disabled', () => {
    const prefs = parsePreferences({
      quietHours: { enabled: false, startHour: 0, endHour: 23, timezone: 'UTC' },
    });
    expect(isInQuietHours(prefs, new Date(Date.UTC(2026, 0, 1, 3, 0, 0)))).toBe(false);
  });
});

describe('shouldRateLimit — notificationMode filter', () => {
  it('suppresses non-high-leverage events when mode is high_leverage_only', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({ notificationMode: 'high_leverage_only' });
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
      }),
    });
    expect(await shouldRateLimit(event, prefs, store, NOW)).toBe(true);
  });

  it('allows high-leverage events (red_zone) when mode is high_leverage_only', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({ notificationMode: 'high_leverage_only' });
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [
          { type: 'offense_active', triggeringPlayerIds: ['p1'] },
          { type: 'red_zone', triggeringPlayerIds: [] },
        ],
      }),
    });
    expect(await shouldRateLimit(event, prefs, store, NOW)).toBe(false);
  });

  it('allows high-leverage events (star_player_active) when mode is high_leverage_only', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({ notificationMode: 'high_leverage_only' });
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [{ type: 'star_player_active', triggeringPlayerIds: ['p1'] }],
      }),
    });
    expect(await shouldRateLimit(event, prefs, store, NOW)).toBe(false);
  });

  it('allows high-leverage events (close_game) when mode is high_leverage_only', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({ notificationMode: 'high_leverage_only' });
    const event = makeEvent({
      newState: makeFlagState({ reasons: [{ type: 'close_game', triggeringPlayerIds: [] }] }),
    });
    expect(await shouldRateLimit(event, prefs, store, NOW)).toBe(false);
  });

  it('suppresses everything when mode is off', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({ notificationMode: 'off' });
    expect(await shouldRateLimit(makeEvent(), prefs, store, NOW)).toBe(true);
  });

  it('mode "all" (default) does not filter by leverage', async () => {
    const store = new InMemoryRateLimitStore();
    const prefs = parsePreferences({});
    const event = makeEvent({
      newState: makeFlagState({
        reasons: [{ type: 'offense_active', triggeringPlayerIds: ['p1'] }],
      }),
    });
    expect(await shouldRateLimit(event, prefs, store, NOW)).toBe(false);
  });
});
