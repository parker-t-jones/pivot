/**
 * Whether a `flag_added` becomes a push.
 *
 * "Connected" here is `active_users` membership, not an open socket. Sockets live in the API
 * process's in-memory registry and are never written to Redis, so this process cannot see them.
 * The API adds the user on socket connect/ping and deletes them on socket close. The 5-minute
 * score is only a ceiling when `close` never arrives.
 */
export type PushDecisionResult =
  | 'sent'
  | 'skipped_primary_connected'
  | 'rate_limited'
  | 'collapsed'
  | 'no_token';

export function decidePushDelivery(input: {
  connected: boolean;
  /** Stored primary. Age does not matter — an hours-old row still sends when `connected` is false. */
  primaryGameId: string | null;
  gameId: string;
  hasToken: boolean;
}): 'sent' | 'skipped_primary_connected' | 'no_token' {
  if (input.connected && input.primaryGameId === input.gameId) {
    return 'skipped_primary_connected';
  }
  if (!input.hasToken) return 'no_token';
  return 'sent';
}

/** Timestamps carried on the push-decision line. Missing values log as `-`. */
export interface PushDecisionTiming {
  anchorPlayId?: string | null | undefined;
  playWallclock?: string | null | undefined;
  seenAt?: string | null | undefined;
  enqueuedAt?: string | null | undefined;
  /** Set only after the push send call returns success. Ignored unless `result` is `sent`. */
  sentAt?: string | null | undefined;
}

function logged(value: string | null | undefined): string {
  if (value === undefined || value === null || value === '') return '-';
  return value;
}

/** Milliseconds between two ISO timestamps. Missing or unparseable sides log as `-`. */
function lagMs(later: string | null | undefined, earlier: string | null | undefined): string {
  const laterIso = logged(later);
  const earlierIso = logged(earlier);
  if (laterIso === '-' || earlierIso === '-') return '-';
  const laterMs = Date.parse(laterIso);
  const earlierMs = Date.parse(earlierIso);
  if (Number.isNaN(laterMs) || Number.isNaN(earlierMs)) return '-';
  return String(laterMs - earlierMs);
}

/** `user` is the first 8 characters of the user id. Never an email or a push token. */
export function formatPushDecisionLog(input: {
  userId: string;
  gameId: string;
  flagId: string;
  result: PushDecisionResult;
  timing?: PushDecisionTiming;
}): string {
  const timing = input.timing;
  const sentAt = input.result === 'sent' ? timing?.sentAt : undefined;
  const base = `[dispatcher] push decision user=${input.userId.slice(0, 8)} game=${input.gameId} flag=${input.flagId} result=${input.result}`;
  return (
    `${base} anchor_play=${logged(timing?.anchorPlayId)}` +
    ` play_wallclock=${logged(timing?.playWallclock)}` +
    ` seen_at=${logged(timing?.seenAt)}` +
    ` enqueued_at=${logged(timing?.enqueuedAt)}` +
    ` sent_at=${logged(sentAt)}` +
    ` post_lag_ms=${lagMs(timing?.seenAt, timing?.playWallclock)}` +
    ` send_lag_ms=${lagMs(sentAt, timing?.seenAt)}`
  );
}
