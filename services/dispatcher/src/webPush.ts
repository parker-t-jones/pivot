/** One browser subscription. `deviceId` is the same id the web socket writes into presence. */
export interface WebPushSubscription {
  endpoint: string;
  deviceId: string;
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionStore {
  listForUser(userId: string): Promise<WebPushSubscription[]>;
  recordSuccess(endpoint: string, atMs: number): Promise<void>;
  deleteEndpoint(endpoint: string): Promise<void>;
}

/** Stale nudges are dropped by the push service instead of arriving late. */
export const WEB_PUSH_TTL_SECONDS = 60;

export interface WebPushRequest {
  endpoint: string;
  deviceId: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  /** Web Push `Topic` and the notification `tag`. At most 32 characters. */
  collapseKey: string;
  ttlSeconds: number;
  urgency: 'high';
  data: unknown;
}

export interface WebPushResult {
  ok: boolean;
  statusCode: number;
}

export interface WebPushSender {
  send(request: WebPushRequest): Promise<WebPushResult>;
}

/**
 * One key per user, 32 URL-safe characters, so a newer nudge replaces an older one
 * that the push service has not delivered yet. A UUID's hex is already that length.
 */
export function webPushCollapseKey(userId: string): string {
  const compact = userId.replace(/-/g, '');
  if (compact.length >= 32) return compact.slice(0, 32);
  return compact.padEnd(32, '0');
}

export class CapturingWebPushSender implements WebPushSender {
  readonly calls: WebPushRequest[] = [];
  nextResult: WebPushResult = { ok: true, statusCode: 201 };

  async send(request: WebPushRequest): Promise<WebPushResult> {
    this.calls.push(request);
    return this.nextResult;
  }
}

export class InMemoryWebPushSubscriptionStore implements WebPushSubscriptionStore {
  readonly rows = new Map<string, WebPushSubscription & { userId: string; lastSuccessAt: number | null }>();

  constructor(seed: Array<WebPushSubscription & { userId: string }> = []) {
    for (const row of seed) {
      this.rows.set(row.endpoint, { ...row, lastSuccessAt: null });
    }
  }

  async listForUser(userId: string): Promise<WebPushSubscription[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .map(({ endpoint, deviceId, p256dh, auth }) => ({ endpoint, deviceId, p256dh, auth }));
  }

  async recordSuccess(endpoint: string, atMs: number): Promise<void> {
    const row = this.rows.get(endpoint);
    if (row) row.lastSuccessAt = atMs;
  }

  async deleteEndpoint(endpoint: string): Promise<void> {
    this.rows.delete(endpoint);
  }
}

/**
 * Send to each of the user's browsers. A subscription is skipped only when THAT device
 * has a live visible connection and the flag's game is the primary. Hidden does not count.
 * This does not record a rate-limit hit; the caller already recorded the event once.
 */
export async function deliverWebPushes(input: {
  sender: WebPushSender;
  subscriptions: WebPushSubscriptionStore;
  userId: string;
  gameId: string;
  primaryGameId: string | null;
  isDeviceActive: (userId: string, deviceId: string) => Promise<boolean>;
  title: string;
  body: string;
  data: unknown;
  nowMs: number;
}): Promise<void> {
  const subs = await input.subscriptions.listForUser(input.userId);
  const collapseKey = webPushCollapseKey(input.userId);
  for (const sub of subs) {
    const visible = await input.isDeviceActive(input.userId, sub.deviceId);
    if (visible && input.primaryGameId === input.gameId) {
      console.log(`[web-push] device=${sub.deviceId} result=skipped_visible_primary`);
      continue;
    }
    let result: WebPushResult;
    try {
      result = await input.sender.send({
        endpoint: sub.endpoint,
        deviceId: sub.deviceId,
        p256dh: sub.p256dh,
        auth: sub.auth,
        title: input.title,
        body: input.body,
        collapseKey,
        ttlSeconds: WEB_PUSH_TTL_SECONDS,
        urgency: 'high',
        data: input.data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[web-push] send threw', { endpoint: sub.endpoint, error: message });
      console.log(`[web-push] device=${sub.deviceId} result=failed`);
      continue;
    }
    if (result.statusCode === 404 || result.statusCode === 410) {
      await input.subscriptions.deleteEndpoint(sub.endpoint);
      console.log(`[web-push] device=${sub.deviceId} result=gone`);
      continue;
    }
    if (result.ok) {
      await input.subscriptions.recordSuccess(sub.endpoint, input.nowMs);
      console.log(`[web-push] device=${sub.deviceId} result=sent`);
      continue;
    }
    console.log(`[web-push] device=${sub.deviceId} result=failed`);
  }
}
