import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FlagEventPersistence,
  PersistFlagEventResult,
  PersistedFlagEventInput,
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
}
