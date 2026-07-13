import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  CapturingPushNotifier,
  ExpoPushNotifier,
  NoOpPushNotifier,
  createPushNotifier,
  type ExpoClient,
  type PushPayload,
} from './pushNotifier.js';

const VALID_TOKEN = 'ExponentPushToken[abcdefghij123456789ABC]';

function makePayload(overrides: Partial<PushPayload> = {}): PushPayload {
  return {
    token: VALID_TOKEN,
    title: 'Jonathan Taylor active',
    body: 'Colts have the ball — Q2, 7:14. Tap to watch.',
    data: { eventId: 'evt-1' },
    ...overrides,
  };
}

/** Fake `ExpoClient` — records every chunk it's asked to send and lets tests script ticket
 *  responses/failures per chunk, without touching the real Expo API. */
function makeFakeExpo(ticketsPerChunk: (chunk: ExpoPushMessage[]) => ExpoPushTicket[]): {
  client: ExpoClient;
  sentChunks: ExpoPushMessage[][];
} {
  const sentChunks: ExpoPushMessage[][] = [];
  const client: ExpoClient = {
    chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
      const chunks: ExpoPushMessage[][] = [];
      for (let i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
      }
      return chunks;
    },
    async sendPushNotificationsAsync(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
      sentChunks.push(chunk);
      return ticketsPerChunk(chunk);
    },
  };
  return { client, sentChunks };
}

describe('NoOpPushNotifier', () => {
  it('resolves success without sending anything', async () => {
    const notifier = new NoOpPushNotifier();
    const result = await notifier.sendPush(makePayload());
    expect(result).toEqual({ success: true });
    expect(notifier.id).toBe('none');
  });
});

describe('CapturingPushNotifier', () => {
  it('collects calls and defaults id to expo', async () => {
    const notifier = new CapturingPushNotifier();
    const payload = makePayload();
    await notifier.sendPush(payload);
    expect(notifier.calls).toEqual([payload]);
    expect(notifier.id).toBe('expo');
  });

  it('allows overriding id and scripting a failure result', async () => {
    const notifier = new CapturingPushNotifier('none');
    notifier.nextResult = { success: false, error: 'boom' };
    expect(notifier.id).toBe('none');
    await expect(notifier.sendPush(makePayload())).resolves.toEqual({
      success: false,
      error: 'boom',
    });
  });
});

describe('ExpoPushNotifier', () => {
  it('rejects a malformed token without touching the network', async () => {
    const { client, sentChunks } = makeFakeExpo(() => []);
    const notifier = new ExpoPushNotifier(client);

    const result = await notifier.sendPush(makePayload({ token: 'not-a-real-token' }));

    expect(result).toEqual({ success: false, error: 'invalid_expo_push_token' });
    expect(sentChunks).toHaveLength(0);
  });

  it('sends a single push and resolves success on an ok ticket', async () => {
    const { client } = makeFakeExpo(() => [{ status: 'ok', id: 'ticket-1' }]);
    const notifier = new ExpoPushNotifier(client);

    await expect(notifier.sendPush(makePayload())).resolves.toEqual({ success: true });
  });

  it('surfaces a ticket-level error as a failed PushResult', async () => {
    const { client } = makeFakeExpo(() => [
      { status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } },
    ]);
    const notifier = new ExpoPushNotifier(client);

    await expect(notifier.sendPush(makePayload())).resolves.toEqual({
      success: false,
      error: 'DeviceNotRegistered',
    });
  });

  it('surfaces a transport-level rejection (sendPushNotificationsAsync throws) as a failed PushResult', async () => {
    const client: ExpoClient = {
      chunkPushNotifications: (messages) => [messages],
      sendPushNotificationsAsync: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const notifier = new ExpoPushNotifier(client);

    await expect(notifier.sendPush(makePayload())).resolves.toEqual({
      success: false,
      error: 'network down',
    });
  });

  it('coalesces concurrent sendPush calls issued in the same microtask turn into one batch', async () => {
    const { client, sentChunks } = makeFakeExpo((chunk) =>
      chunk.map((_, i) => ({ status: 'ok', id: `ticket-${i}` })),
    );
    const notifier = new ExpoPushNotifier(client);

    const [r1, r2, r3] = await Promise.all([
      notifier.sendPush(makePayload({ token: VALID_TOKEN, data: { i: 1 } })),
      notifier.sendPush(makePayload({ token: VALID_TOKEN, data: { i: 2 } })),
      notifier.sendPush(makePayload({ token: VALID_TOKEN, data: { i: 3 } })),
    ]);

    expect(sentChunks).toHaveLength(1);
    expect(sentChunks[0]).toHaveLength(3);
    expect([r1, r2, r3]).toEqual([{ success: true }, { success: true }, { success: true }]);
  });

  it('does not coalesce sequential (awaited) calls — matches the dispatcher tick’s one-at-a-time loop', async () => {
    const { client, sentChunks } = makeFakeExpo(() => [{ status: 'ok', id: 't' }]);
    const notifier = new ExpoPushNotifier(client);

    await notifier.sendPush(makePayload());
    await notifier.sendPush(makePayload());

    expect(sentChunks).toHaveLength(2);
    expect(sentChunks[0]).toHaveLength(1);
    expect(sentChunks[1]).toHaveLength(1);
  });

  it('splits a batch larger than 100 into multiple chunked calls, matching results back up', async () => {
    const { client, sentChunks } = makeFakeExpo((chunk) =>
      chunk.map((_, i) => ({ status: 'ok', id: `t-${i}` })),
    );
    const notifier = new ExpoPushNotifier(client);

    const payloads = Array.from({ length: 120 }, (_, i) =>
      notifier.sendPush(makePayload({ token: VALID_TOKEN, data: { i } })),
    );
    const results = await Promise.all(payloads);

    expect(sentChunks).toHaveLength(2);
    expect(sentChunks[0]).toHaveLength(100);
    expect(sentChunks[1]).toHaveLength(20);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('maps PushPayload fields onto the Expo message shape (title/body/data/to)', async () => {
    const { client, sentChunks } = makeFakeExpo(() => [{ status: 'ok', id: 't' }]);
    const notifier = new ExpoPushNotifier(client);

    await notifier.sendPush(
      makePayload({ token: VALID_TOKEN, title: 'T', body: 'B', data: { gameId: 'g1' } }),
    );

    expect(sentChunks[0]?.[0]).toEqual({
      to: VALID_TOKEN,
      title: 'T',
      body: 'B',
      data: { gameId: 'g1' },
    });
  });
});

describe('createPushNotifier (PUSH_DRIVER factory)', () => {
  it('returns a NoOpPushNotifier for pushDriver "none"', () => {
    const notifier = createPushNotifier({ pushDriver: 'none' });
    expect(notifier).toBeInstanceOf(NoOpPushNotifier);
    expect(notifier.id).toBe('none');
  });

  it('returns an ExpoPushNotifier for pushDriver "expo"', () => {
    const notifier = createPushNotifier({ pushDriver: 'expo' });
    expect(notifier).toBeInstanceOf(ExpoPushNotifier);
    expect(notifier.id).toBe('expo');
  });
});
