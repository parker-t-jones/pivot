import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FlagEventPersistence,
  PendingPushRetry,
  PersistFlagEventResult,
  PersistedFlagEventInput,
  PushOutcome,
  PushRetryPayload,
} from '@pivot/dispatcher';
import type { Database, Json } from '../lib/database.types.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Service-role `flag_events` insert for the runner. The row id is `gen_random_uuid()`.
 * A unique-key conflict is already delivered.
 */
export class SupabaseFlagEventPersistence implements FlagEventPersistence {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async persistFlagEvent(input: PersistedFlagEventInput): Promise<PersistFlagEventResult> {
    const { data, error } = await this.client
      .from('flag_events')
      .insert({
        user_id: input.userId,
        game_id: input.gameId,
        event_type: input.eventType,
        triggering_play_id: input.triggeringPlayId,
        priority_score: input.priorityScore,
        reasons: input.reasons as unknown as Json,
        fired_at: new Date(input.firedAt).toISOString(),
        delivered_at: new Date(input.deliveredAt).toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { inserted: false };
      throw new Error(`flag_events insert failed: ${error.code ?? 'unknown'} ${error.message}`);
    }
    return { inserted: true, id: data.id };
  }

  async recordPushOutcome(outcome: PushOutcome): Promise<void> {
    const update =
      outcome.status === 'pending'
        ? {
            push_status: outcome.status,
            push_attempts: outcome.attempts,
            push_last_error: outcome.lastError,
            push_next_attempt_at: new Date(outcome.nextAttemptAt).toISOString(),
            push_payload: outcome.payload as unknown as Json,
          }
        : {
            push_status: outcome.status,
            push_next_attempt_at: null,
          };
    const { error } = await this.client.from('flag_events').update(update).eq('id', outcome.id);
    if (error) {
      throw new Error(
        `flag_events push outcome failed: ${error.code ?? 'unknown'} ${error.message}`,
      );
    }
  }

  async duePushRetries(now: number): Promise<PendingPushRetry[]> {
    const { data, error } = await this.client
      .from('flag_events')
      .select('id, user_id, delivered_at, push_attempts, push_payload')
      .eq('push_status', 'pending')
      .lte('push_next_attempt_at', new Date(now).toISOString());
    if (error) {
      throw new Error(
        `flag_events push retry read failed: ${error.code ?? 'unknown'} ${error.message}`,
      );
    }
    const due: PendingPushRetry[] = [];
    for (const row of data) {
      const payload = parsePushPayload(row.push_payload);
      if (!payload || row.delivered_at === null) continue;
      due.push({
        id: row.id,
        userId: row.user_id,
        deliveredAt: Date.parse(row.delivered_at),
        attempts: row.push_attempts,
        payload,
      });
    }
    return due;
  }
}

function parsePushPayload(value: Json | null): PushRetryPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const token = value['token'];
  const title = value['title'];
  const body = value['body'];
  if (typeof token !== 'string' || typeof title !== 'string' || typeof body !== 'string')
    return null;
  if (!Object.prototype.hasOwnProperty.call(value, 'data')) return null;
  return { token, title, body, data: value['data'] ?? null };
}
