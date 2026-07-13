import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

/**
 * Sprint 6 Phase 1 — the swap-ready `PushNotifier` boundary (PLAN.md Section 2's principle, applied
 * to the push transport). `id` includes `'apns'` even though no APNs-direct implementation ships in
 * v1 — same shape as `PlaybackSource`'s `id` enum carrying `'embedded'` ahead of its Phase 2
 * implementation, so a future driver is a local addition, not an interface change.
 */
export type PushDriverId = 'expo' | 'apns' | 'none';

/**
 * Carries the same information as the Section 9 WebSocket `flag_event` envelope's `payload` —
 * `title`/`body` for display, and `data` holding the full payload object verbatim, so a client can
 * act on a push identically to a WebSocket delivery (Phase 6's shared rendering path). `data` is
 * intentionally `unknown` here rather than importing `FlagEventEnvelope['payload']` from
 * `delivery.ts` — `delivery.ts` depends on this module (to send push), so this module doesn't depend
 * back on it. Callers own constructing a value that matches the WebSocket payload shape.
 */
export interface PushPayload {
  /** Destination Expo push token (`ExponentPushToken[...]`). */
  token: string;
  title: string;
  body: string;
  data: unknown;
}

export interface PushResult {
  success: boolean;
  /** Present when `success` is `false` — a human-readable reason (invalid token, ticket-level error,
   *  transport failure). Never throws; failures are reported through this field so `delivery.ts` can
   *  log without needing a try/catch around every driver. */
  error?: string;
}

export interface PushNotifier {
  id: PushDriverId;
  sendPush(payload: PushPayload): Promise<PushResult>;
}

/** Boots without any Expo credentials configured (PUSH_DRIVER unset/`none` — the local-dev default).
 *  Logs so a missing push send is visible in dev logs without ever touching the network. */
export class NoOpPushNotifier implements PushNotifier {
  readonly id = 'none' as const;

  async sendPush(payload: PushPayload): Promise<PushResult> {
    console.log(`[push:noop] would send "${payload.title}" to ${payload.token}`);
    return { success: true };
  }
}

/** Collects every call for assertions in `delivery.test.ts` and friends — never touches the real Expo
 *  API. `id` defaults to `'expo'` (tests exercising `deliverFlagEvent`'s push branch want to assert
 *  push WAS attempted, so defaulting to the "push is configured" id is the more useful default),
 *  but is overridable for tests that specifically exercise `id`-based branching. */
export class CapturingPushNotifier implements PushNotifier {
  readonly id: PushDriverId;
  readonly calls: PushPayload[] = [];
  /** Set to make `sendPush` resolve with a failure, for testing delivery's try/catch handling. */
  nextResult: PushResult = { success: true };

  constructor(id: PushDriverId = 'expo') {
    this.id = id;
  }

  async sendPush(payload: PushPayload): Promise<PushResult> {
    this.calls.push(payload);
    return this.nextResult;
  }
}

/** The subset of the `expo-server-sdk` `Expo` client `ExpoPushNotifier` calls — narrowed so tests can
 *  inject a fake without constructing a real `Expo` instance (mirrors `RedisGameStateProvider`
 *  taking an already-constructed `Redis` client rather than building one internally). */
export type ExpoClient = Pick<Expo, 'chunkPushNotifications' | 'sendPushNotificationsAsync'>;

interface PendingSend {
  payload: PushPayload;
  resolve: (result: PushResult) => void;
}

/**
 * Real Expo Push driver. `sendPush` is called once per event by `deliverFlagEvent` (Section 8), but
 * internally coalesces every call issued within the same microtask turn into a single batch —
 * Expo's API accepts up to 100 messages per call (`chunkPushNotifications` enforces that split), and
 * the dispatcher tick's own batch size (`DEFAULT_BATCH_SIZE` in `dispatcher.ts`) is already 100 for
 * the same reason. Under today's sequential-per-event tick loop this degrades to a batch of one
 * (each `deliverFlagEvent` call is awaited before the next starts) — batching activates for any
 * future caller that fires multiple sends concurrently (e.g. `Promise.all`) without requiring a
 * debounce window that would otherwise add latency to the sequential path.
 *
 * Deliberately does NOT poll delivery receipts (`getPushNotificationReceiptsAsync`) — sprint
 * constraint: "Push receipts and retry logic are v1.5." A ticket-level error (returned synchronously
 * from `sendPushNotificationsAsync`, e.g. malformed token) is reported as a failure; receipt-only
 * failures (e.g. `DeviceNotRegistered`, which Expo only surfaces via the receipt endpoint ~15+ min
 * later) are out of scope for v1 and would require storing ticket ids to poll for — new state this
 * sprint explicitly avoids.
 */
export class ExpoPushNotifier implements PushNotifier {
  readonly id = 'expo' as const;
  private pending: PendingSend[] = [];
  private flushScheduled = false;

  constructor(private readonly expo: ExpoClient) {}

  async sendPush(payload: PushPayload): Promise<PushResult> {
    if (!Expo.isExpoPushToken(payload.token)) {
      return { success: false, error: 'invalid_expo_push_token' };
    }
    // Batching only activates when multiple `sendPush` calls are in flight concurrently (they share
    // the microtask-scheduled flush below). `runDispatcherTick` (Section 8) serializes delivery one
    // event at a time by design — a Sprint 5 invariant for the rate limiter's read-then-write
    // ordering, not an oversight — so under the current dispatcher this is always a batch of one.
    // The machinery is intentionally left ready rather than removed: it's correct today, and free to
    // start batching for real the moment any caller fires concurrent sends.
    return new Promise<PushResult>((resolve) => {
      this.pending.push({ payload, resolve });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    const messages: ExpoPushMessage[] = batch.map(({ payload }) => ({
      to: payload.token,
      title: payload.title,
      body: payload.body,
      ...(payload.data !== undefined ? { data: payload.data as Record<string, unknown> } : {}),
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'expo_send_failed';
        for (let i = 0; i < chunk.length; i++) {
          batch[cursor + i]?.resolve({ success: false, error: message });
        }
        cursor += chunk.length;
        continue;
      }
      for (let i = 0; i < chunk.length; i++) {
        const ticket = tickets[i];
        const item = batch[cursor + i];
        if (!item) continue;
        if (!ticket || ticket.status === 'error') {
          item.resolve({
            success: false,
            error: ticket?.status === 'error' ? ticket.message : 'no_ticket_returned',
          });
        } else {
          item.resolve({ success: true });
        }
      }
      cursor += chunk.length;
    }
  }
}

/** Minimal config the factory needs, passed explicitly rather than importing an `env` module —
 *  same rationale as `RedisProviderConfig` (dispatcher stays free of an `@fantasy-focus/api`
 *  dependency; sprint decision #9 from Sprint 5). */
export interface PushNotifierConfig {
  pushDriver: 'expo' | 'none';
  expoAccessToken?: string | undefined;
}

/** `PUSH_DRIVER` selects the implementation at boot (mirrors `CACHE_DRIVER` / `createGameStateStore`).
 *  Defaults to `'none'` so local dev never requires Expo credentials. */
export function createPushNotifier(config: PushNotifierConfig): PushNotifier {
  if (config.pushDriver === 'expo') {
    const expo = new Expo(config.expoAccessToken ? { accessToken: config.expoAccessToken } : {});
    return new ExpoPushNotifier(expo);
  }
  return new NoOpPushNotifier();
}
