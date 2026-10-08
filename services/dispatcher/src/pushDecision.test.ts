import { describe, expect, it } from 'vitest';
import { decidePushDelivery, formatPushDecisionLog } from './pushDecision.js';

const GAME = '275b0f97-ccf1-44cd-8cd7-fede32e56763';
const OTHER = '11111111-1111-4111-8111-111111111111';

describe('decidePushDelivery', () => {
  it('skips when this game is primary and the user is connected', () => {
    expect(
      decidePushDelivery({
        connected: true,
        primaryGameId: GAME,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('skipped_primary_connected');
  });

  it('sends when this game is primary but the user is not connected', () => {
    expect(
      decidePushDelivery({
        connected: false,
        primaryGameId: GAME,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('sent');
  });

  it('sends when there is no primary', () => {
    expect(
      decidePushDelivery({
        connected: true,
        primaryGameId: null,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('sent');
  });

  it('sends when a different game is primary and the user is connected', () => {
    expect(
      decidePushDelivery({
        connected: true,
        primaryGameId: OTHER,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('sent');
  });

  it('sends a primary stored hours ago when the user is not connected', () => {
    // Session age is not an input. Not-connected is what sends, however old the row is.
    expect(
      decidePushDelivery({
        connected: false,
        primaryGameId: GAME,
        gameId: GAME,
        hasToken: true,
      }),
    ).toBe('sent');
  });

  it('reports no_token when a send would otherwise go out', () => {
    expect(
      decidePushDelivery({
        connected: false,
        primaryGameId: null,
        gameId: GAME,
        hasToken: false,
      }),
    ).toBe('no_token');
  });
});

describe('formatPushDecisionLog', () => {
  it('keeps eight characters of the user id and omits the rest', () => {
    expect(
      formatPushDecisionLog({
        userId: '2057923d-af10-4bfc-966c-db93341863f2',
        gameId: GAME,
        flagId: 'evt-1',
        result: 'sent',
      }),
    ).toBe(
      `[dispatcher] push decision user=2057923d game=${GAME} flag=evt-1 result=sent anchor_play=- play_wallclock=- seen_at=- enqueued_at=- sent_at=- post_lag_ms=- send_lag_ms=-`,
    );
  });

  it('logs every timing field when the push was sent', () => {
    expect(
      formatPushDecisionLog({
        userId: '2057923d-af10-4bfc-966c-db93341863f2',
        gameId: GAME,
        flagId: 'evt-1',
        result: 'sent',
        timing: {
          anchorPlayId: '40187330839',
          playWallclock: '2026-10-11T17:00:00.000Z',
          seenAt: '2026-10-11T17:00:02.500Z',
          enqueuedAt: '2026-10-11T17:00:04.000Z',
          sentAt: '2026-10-11T17:00:05.250Z',
        },
      }),
    ).toBe(
      `[dispatcher] push decision user=2057923d game=${GAME} flag=evt-1 result=sent anchor_play=40187330839 play_wallclock=2026-10-11T17:00:00.000Z seen_at=2026-10-11T17:00:02.500Z enqueued_at=2026-10-11T17:00:04.000Z sent_at=2026-10-11T17:00:05.250Z post_lag_ms=2500 send_lag_ms=2750`,
    );
  });

  it('logs a dash for a missing wallclock and does not invent a post lag', () => {
    expect(
      formatPushDecisionLog({
        userId: '2057923d-af10-4bfc-966c-db93341863f2',
        gameId: GAME,
        flagId: 'evt-1',
        result: 'sent',
        timing: {
          anchorPlayId: '40187330839',
          seenAt: '2026-10-11T17:00:02.500Z',
          enqueuedAt: '2026-10-11T17:00:04.000Z',
          sentAt: '2026-10-11T17:00:05.250Z',
        },
      }),
    ).toBe(
      `[dispatcher] push decision user=2057923d game=${GAME} flag=evt-1 result=sent anchor_play=40187330839 play_wallclock=- seen_at=2026-10-11T17:00:02.500Z enqueued_at=2026-10-11T17:00:04.000Z sent_at=2026-10-11T17:00:05.250Z post_lag_ms=- send_lag_ms=2750`,
    );
  });

  it('omits sent_at on a skipped result even when a timestamp was passed', () => {
    expect(
      formatPushDecisionLog({
        userId: 'u1',
        gameId: GAME,
        flagId: 'evt-1',
        result: 'skipped_primary_connected',
        timing: {
          anchorPlayId: '40187330839',
          playWallclock: '2026-10-11T17:00:00.000Z',
          seenAt: '2026-10-11T17:00:02.500Z',
          enqueuedAt: '2026-10-11T17:00:04.000Z',
          sentAt: '2026-10-11T17:00:05.250Z',
        },
      }),
    ).toBe(
      `[dispatcher] push decision user=u1 game=${GAME} flag=evt-1 result=skipped_primary_connected anchor_play=40187330839 play_wallclock=2026-10-11T17:00:00.000Z seen_at=2026-10-11T17:00:02.500Z enqueued_at=2026-10-11T17:00:04.000Z sent_at=- post_lag_ms=2500 send_lag_ms=-`,
    );
  });

  it('logs a negative lag as the raw difference', () => {
    expect(
      formatPushDecisionLog({
        userId: 'u1',
        gameId: GAME,
        flagId: 'evt-1',
        result: 'sent',
        timing: {
          anchorPlayId: 'p1',
          playWallclock: '2026-10-11T17:01:00.000Z',
          seenAt: '2026-10-11T17:00:20.000Z',
          enqueuedAt: '2026-10-11T17:00:20.000Z',
          sentAt: '2026-10-11T17:00:10.000Z',
        },
      }),
    ).toContain('post_lag_ms=-40000 send_lag_ms=-10000');
  });

  it('logs an absurd lag without clamping it', () => {
    const playWallclock = '1970-01-01T00:00:00.000Z';
    const seenAt = '2099-01-01T00:00:00.000Z';
    const lag = Date.parse(seenAt) - Date.parse(playWallclock);

    const line = formatPushDecisionLog({
      userId: 'u1',
      gameId: GAME,
      flagId: 'evt-1',
      result: 'sent',
      timing: {
        anchorPlayId: 'p1',
        playWallclock,
        seenAt,
        sentAt: seenAt,
      },
    });

    expect(lag).toBeGreaterThan(1_000_000_000_000);
    expect(line).toContain(`play_wallclock=${playWallclock} seen_at=${seenAt}`);
    expect(line).toContain(`post_lag_ms=${lag}`);
  });
});
