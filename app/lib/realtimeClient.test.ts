import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isLiveDisplayPhase,
  shouldConnectHomeRealtime,
} from './homeState';
import {
  REALTIME_PING_INTERVAL_MS,
  REALTIME_PONG_TIMEOUT_MS,
  RealtimeClient,
  type WebSocketLike,
} from './realtimeClient';

class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitJson(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

describe('isLiveDisplayPhase / shouldConnectHomeRealtime', () => {
  it('isLiveDisplayPhase is true only for regular and post', () => {
    expect(isLiveDisplayPhase('off')).toBe(false);
    expect(isLiveDisplayPhase('pre')).toBe(false);
    expect(isLiveDisplayPhase('regular')).toBe(true);
    expect(isLiveDisplayPhase('post')).toBe(true);
  });

  it('does not open a socket when display_phase is off or pre', () => {
    expect(
      shouldConnectHomeRealtime({
        homeReady: true,
        hasLeagues: true,
        displayPhase: 'off',
      }),
    ).toBe(false);
    expect(
      shouldConnectHomeRealtime({
        homeReady: true,
        hasLeagues: true,
        displayPhase: 'pre',
      }),
    ).toBe(false);
  });

  it('opens when home is ready, has leagues, and display_phase is regular/post', () => {
    expect(
      shouldConnectHomeRealtime({
        homeReady: true,
        hasLeagues: true,
        displayPhase: 'regular',
      }),
    ).toBe(true);
    expect(
      shouldConnectHomeRealtime({
        homeReady: true,
        hasLeagues: true,
        displayPhase: 'post',
      }),
    ).toBe(true);
  });

  it('stays closed when home is not ready or has no leagues', () => {
    expect(
      shouldConnectHomeRealtime({
        homeReady: false,
        hasLeagues: true,
        displayPhase: 'regular',
      }),
    ).toBe(false);
    expect(
      shouldConnectHomeRealtime({
        homeReady: true,
        hasLeagues: false,
        displayPhase: 'regular',
      }),
    ).toBe(false);
  });
});

describe('RealtimeClient', () => {
  let token: string;
  const getAccessToken = vi.fn(async () => token);
  const onFlagEvent = vi.fn();
  const onReconnected = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    token = 'token-1';
    getAccessToken.mockClear();
    getAccessToken.mockImplementation(async () => token);
    onFlagEvent.mockClear();
    onReconnected.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createClient(overrides: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
    return new RealtimeClient({
      apiBaseUrl: 'http://127.0.0.1:3000',
      getAccessToken,
      onFlagEvent,
      onReconnected,
      WebSocketImpl: MockWebSocket as unknown as new (url: string) => WebSocketLike,
      initialBackoffMs: 1000,
      maxBackoffMs: 8000,
      createId: () => 'fixed-id',
      ...overrides,
    });
  }

  async function flushConnect(): Promise<MockWebSocket> {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    const socket = MockWebSocket.instances.at(-1);
    if (!socket) throw new Error('expected socket');
    return socket;
  }

  it('connects with JWT in the query string at /v1/realtime', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    expect(socket.url).toBe('ws://127.0.0.1:3000/v1/realtime?token=token-1');
    expect(getAccessToken).toHaveBeenCalled();
  });

  it('does not call onReconnected on the initial open', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    socket.open();
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('calls onReconnected after a drop and successful re-connect (reconcile seam)', async () => {
    const client = createClient();
    client.start();
    const first = await flushConnect();
    first.open();
    expect(onReconnected).not.toHaveBeenCalled();

    first.close(); // unclean from client POV — intentionalClose is false
    await vi.advanceTimersByTimeAsync(1000);
    const second = await flushConnect();
    expect(second).not.toBe(first);
    second.open();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('refetches a fresh token on each connect attempt', async () => {
    const client = createClient();
    client.start();
    const first = await flushConnect();
    first.open();

    token = 'token-2';
    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    const second = await flushConnect();
    expect(second.url).toContain('token=token-2');
  });

  it('TOKEN_REFRESHED path: reconnectForTokenRefresh closes and reopens with new token + reconciles', async () => {
    const client = createClient();
    client.start();
    const first = await flushConnect();
    first.open();

    token = 'token-refreshed';
    client.reconnectForTokenRefresh();
    const second = await flushConnect();
    expect(first.readyState).toBe(3);
    expect(second.url).toContain('token=token-refreshed');
    second.open();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('dispatches flag_event payloads', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    socket.open();
    socket.emitJson({
      id: 'e1',
      type: 'flag_event',
      timestamp: 1,
      payload: {
        event_id: 'evt',
        user_id: 'u',
        game_id: 'g',
        event_type: 'flag_added',
        old_state: null,
        new_state: {
          gameId: 'g',
          flagged: true,
          priorityScore: 1,
          reasons: [],
          computedAt: 1,
          possession_team: null,
        },
        action: {
          type: 'prompt',
          cta: 'switch_primary',
          recommended_source: null,
          deep_link_url: null,
        },
        game_summary: {
          home_team: 'KC',
          away_team: 'BUF',
          home_team_name: 'Chiefs',
          away_team_name: 'Bills',
          home_team_primary_color: '',
          home_team_secondary_color: '',
          away_team_primary_color: '',
          away_team_secondary_color: '',
          score: { home: 0, away: 0 },
          quarter: 1,
          time_remaining_sec: 900,
        },
        flagged_players: [],
      },
    });
    expect(onFlagEvent).toHaveBeenCalledTimes(1);
    expect(onFlagEvent.mock.calls[0]?.[0].game_id).toBe('g');
  });

  it('sends ping on the amended ~15s interval and reconnects if pong is missed', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    socket.open();

    await vi.advanceTimersByTimeAsync(REALTIME_PING_INTERVAL_MS);
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!).type).toBe('ping');

    await vi.advanceTimersByTimeAsync(REALTIME_PONG_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1000);
    const second = await flushConnect();
    expect(second).not.toBe(socket);
  });

  it('clears pong timeout when pong arrives', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    socket.open();

    await vi.advanceTimersByTimeAsync(REALTIME_PING_INTERVAL_MS);
    socket.emitJson({ id: 'p', type: 'pong', timestamp: 1, payload: {} });
    await vi.advanceTimersByTimeAsync(REALTIME_PONG_TIMEOUT_MS + 100);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('exponential backoff on repeated failures', async () => {
    const client = createClient();
    client.start();
    const first = await flushConnect();
    first.close();

    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1]!.close();

    await vi.advanceTimersByTimeAsync(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('stop tears down and does not reconnect', async () => {
    const client = createClient();
    client.start();
    const socket = await flushConnect();
    socket.open();
    client.stop();
    expect(socket.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.isStarted()).toBe(false);
  });

  it('stop then start after a prior connect fires onReconnected (foreground-resume seam)', async () => {
    const client = createClient();
    client.start();
    const first = await flushConnect();
    first.open();
    client.stop();

    client.start();
    const second = await flushConnect();
    second.open();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });
});
