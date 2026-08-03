/**
 * Sprint 10 Phase 3 — client for `GET /v1/realtime?token=` (PLAN.md Section 9).
 *
 * Auth is validated once at connect (server never re-checks JWT). Ping keeps the TCP session
 * alive (~15s client interval vs 40s server idle-close). Token refresh / drops require
 * close + reconnect with a fresh access token; there is no mid-socket refresh protocol.
 */
import { isFlagEventPayload, type FlagEventPayload } from './flagEventPayload';
import { buildRealtimeWsUrl } from './realtimeUrl';

/** Amended Phase 3: ~15s against the server's 40s idle-close (PLAN still says 25s). */
export const REALTIME_PING_INTERVAL_MS = 15_000;
/** Section 9: reconnect if no pong within 10s. */
export const REALTIME_PONG_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export interface RealtimeEnvelope {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

export type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface RealtimeClientOptions {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string | null>;
  onFlagEvent: (payload: FlagEventPayload) => void;
  /**
   * Fires after a successful socket open that is NOT the first connect of this client instance
   * (drop/reconnect, token refresh, foreground resume after stop+start with same instance).
   * Home must refetch `/flags/current` here — flag_event has no backlog.
   */
  onReconnected: () => void;
  WebSocketImpl?: WebSocketConstructor;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Deterministic ids for tests. */
  createId?: () => string;
}

export class RealtimeClient {
  private readonly apiBaseUrl: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly onFlagEvent: (payload: FlagEventPayload) => void;
  private readonly onReconnected: () => void;
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly createId: () => string;

  private socket: WebSocketLike | null = null;
  private started = false;
  private intentionalClose = false;
  private hasConnectedOnce = false;
  private reconnectAttempt = 0;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectGeneration = 0;

  constructor(options: RealtimeClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.getAccessToken = options.getAccessToken;
    this.onFlagEvent = options.onFlagEvent;
    this.onReconnected = options.onReconnected;
    this.WebSocketImpl =
      options.WebSocketImpl ??
      (globalThis.WebSocket as unknown as WebSocketConstructor);
    this.pingIntervalMs = options.pingIntervalMs ?? REALTIME_PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? REALTIME_PONG_TIMEOUT_MS;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.createId =
      options.createId ??
      (() =>
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `ping-${Date.now()}-${Math.random()}`);
  }

  /** Whether the client is supposed to stay connected (between start/stop). */
  isStarted(): boolean {
    return this.started;
  }

  isOpen(): boolean {
    return this.socket?.readyState === 1;
  }

  /** Begin connecting. Idempotent while already started. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.intentionalClose = false;
    void this.openSocket();
  }

  /** Tear down socket, timers, and cancel reconnect. Safe to call repeatedly. */
  stop(): void {
    this.started = false;
    this.intentionalClose = true;
    this.connectGeneration += 1;
    this.clearTimers();
    this.closeSocket();
  }

  /**
   * Close and reopen with a fresh token (TOKEN_REFRESHED while socket open).
   * Counts as a re-connect → `onReconnected` after successful open.
   */
  reconnectForTokenRefresh(): void {
    if (!this.started) return;
    this.intentionalClose = true;
    this.connectGeneration += 1;
    this.clearTimers();
    this.closeSocket();
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    void this.openSocket();
  }

  private async openSocket(): Promise<void> {
    if (!this.started) return;
    const generation = ++this.connectGeneration;

    const token = await this.getAccessToken();
    if (!this.started || generation !== this.connectGeneration) return;
    if (!token) {
      this.scheduleReconnect();
      return;
    }

    let url: string;
    try {
      url = buildRealtimeWsUrl(this.apiBaseUrl, token);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.closeSocket();
    this.intentionalClose = false;

    const socket = new this.WebSocketImpl(url);
    this.socket = socket;

    socket.onopen = () => {
      if (!this.started || generation !== this.connectGeneration || this.socket !== socket) {
        return;
      }
      const isReconnect = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.reconnectAttempt = 0;
      this.startPingLoop();
      if (isReconnect) {
        this.onReconnected();
      }
    };

    socket.onmessage = (event) => {
      if (!this.started || this.socket !== socket) return;
      this.handleMessage(typeof event.data === 'string' ? event.data : String(event.data));
    };

    socket.onerror = () => {
      // `onclose` follows; reconnect scheduled there.
    };

    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.clearPingTimers();
      if (!this.started || this.intentionalClose) return;
      if (generation !== this.connectGeneration) return;
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const envelope = parsed as RealtimeEnvelope;
    if (typeof envelope.type !== 'string') return;

    if (envelope.type === 'pong') {
      this.clearPongTimer();
      return;
    }

    if (envelope.type === 'flag_event' && isFlagEventPayload(envelope.payload)) {
      this.onFlagEvent(envelope.payload);
    }
  }

  private startPingLoop(): void {
    this.clearPingTimers();
    this.pingTimer = this.setTimeoutFn(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  private sendPing(): void {
    if (!this.isOpen() || !this.socket) return;
    const envelope: RealtimeEnvelope = {
      id: this.createId(),
      type: 'ping',
      timestamp: Date.now(),
      payload: {},
    };
    try {
      this.socket.send(JSON.stringify(envelope));
    } catch {
      this.forceReconnect();
      return;
    }
    this.pongTimer = this.setTimeoutFn(() => {
      this.forceReconnect();
    }, this.pongTimeoutMs);
    this.pingTimer = this.setTimeoutFn(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  private forceReconnect(): void {
    if (!this.started) return;
    this.intentionalClose = false;
    this.connectGeneration += 1;
    this.clearPingTimers();
    this.closeSocket();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.intentionalClose) return;
    this.clearReconnectTimer();
    const delay = Math.min(
      this.initialBackoffMs * 2 ** this.reconnectAttempt,
      this.maxBackoffMs,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      if (socket.readyState === 0 || socket.readyState === 1) {
        socket.close(1000, 'client close');
      }
    } catch {
      // ignore
    }
  }

  private clearTimers(): void {
    this.clearPingTimers();
    this.clearReconnectTimer();
  }

  private clearPingTimers(): void {
    if (this.pingTimer !== null) {
      this.clearTimeoutFn(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== null) {
      this.clearTimeoutFn(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
