import { createRequire } from 'node:module';
import type { RequestOptions, SendResult, WebPushError } from 'web-push';

import { type WebPushRequest, type WebPushResult, type WebPushSender } from './webPush.js';

const require = createRequire(import.meta.url);
// `web-push` is CommonJS. A named ESM import crashes the API at startup because
// `sendNotification` is assigned with `.bind()`, which Node does not re-export.
const webPush = require('web-push') as {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string | Buffer | null,
    options?: RequestOptions,
  ) => Promise<SendResult>;
};

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

function statusCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as WebPushError).statusCode;
    if (typeof code === 'number') return code;
  }
  return 0;
}

/** Real Web Push sender. VAPID is set when this is constructed, not at import. */
export class WebPushLibrarySender implements WebPushSender {
  constructor(vapid: VapidConfig) {
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(request: WebPushRequest): Promise<WebPushResult> {
    try {
      const result = await webPush.sendNotification(
        {
          endpoint: request.endpoint,
          keys: { p256dh: request.p256dh, auth: request.auth },
        },
        JSON.stringify({
          title: request.title,
          body: request.body,
          collapseKey: request.collapseKey,
          payload: request.data,
        }),
        {
          TTL: request.ttlSeconds,
          urgency: request.urgency,
          topic: request.collapseKey,
        },
      );
      return { ok: true, statusCode: result.statusCode };
    } catch (error) {
      return { ok: false, statusCode: statusCodeOf(error) };
    }
  }
}

export function createWebPushSender(config: {
  subject?: string | undefined;
  publicKey?: string | undefined;
  privateKey?: string | undefined;
}): WebPushLibrarySender | null {
  if (!config.subject || !config.publicKey || !config.privateKey) return null;
  return new WebPushLibrarySender({
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  });
}
