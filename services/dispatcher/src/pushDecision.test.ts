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
      `[dispatcher] push decision user=2057923d game=${GAME} flag=evt-1 result=sent`,
    );
  });
});
