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

/** `user` is the first 8 characters of the user id. Never an email or a push token. */
export function formatPushDecisionLog(input: {
  userId: string;
  gameId: string;
  flagId: string;
  result: PushDecisionResult;
}): string {
  return `[dispatcher] push decision user=${input.userId.slice(0, 8)} game=${input.gameId} flag=${input.flagId} result=${input.result}`;
}
